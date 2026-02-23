# py/core/llm_engine.py
import asyncio
import json

# py/core/llm_engine.py

import re
import time
import random
from openai import OpenAI, AsyncOpenAI

from py.core.prompts import get_auto_fix_json_prompt


def _is_rate_limit_error(e: Exception) -> bool:
    """判断是否为请求频繁/速率限制错误"""
    error_str = str(e).lower()
    rate_limit_keywords = [
        "rate limit",
        "rate_limit",
        "ratelimit",
        "too many requests",
        "429",
        "请求频繁",
        "频率限制",
        "请求过多",
        "限流",
        "quota exceeded",
        "quota_exceeded",
        "server_overloaded",
        "overloaded",
        "服务繁忙",
        "capacity",
        "throttl",
    ]
    return any(kw in error_str for kw in rate_limit_keywords)


class LLMEngine:
    def __init__(
        self, api_key: str, base_url: str, model_name: str, custom_params: str
    ):
        """
        api_key: LLM API Key
        base_url: OpenAI-compatible API URL（例如企业版/自建 LLM）
        model_name: 模型名称
        custom_params: 自定义参数（JSON字符串）
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")  # 去掉末尾斜杠
        self.model_name = model_name

        # custom_params从string转为dict, 兼容None和空字符串
        if not custom_params:
            custom_params = {}
        else:
            custom_params = json.loads(custom_params)
        if not isinstance(custom_params, dict):
            raise ValueError("无效的 custom_params")
        self.custom_params = custom_params

        # 同步客户端（保留兼容）
        self.client = OpenAI(api_key=api_key, base_url=self.base_url)
        # 异步客户端（新增，用于协程场景）
        self.async_client = AsyncOpenAI(api_key=api_key, base_url=self.base_url)

    def _extract_result_tag(self, text: str) -> str:
        """提取 <result> 标签内容"""
        match = re.search(r"<result>(.*?)</result>", text, re.DOTALL)
        if not match:
            raise ValueError("Response does not contain <result>...</result> tag")
        return match.group(1).strip()

    # ========== 同步方法（保留兼容） ==========

    def generate_text_test(self, prompt: str) -> str:
        """
        测试：生成结果并返回（非流式，同步）
        """
        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            timeout=3000,
            **self.custom_params,
        )
        return response.choices[0].message.content

    def generate_text(self, prompt: str, retries: int = 5, delay: float = 1.0) -> str:
        """
        同步生成文本（保留兼容），遇到速率限制时使用更长退避时间
        """
        for attempt in range(retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    stream=False,
                    timeout=3000,
                    **self.custom_params,
                )
                full_text = response.choices[0].message.content
                return full_text

            except Exception as e:
                if attempt < retries - 1:
                    if _is_rate_limit_error(e):
                        # 速率限制：使用更长的退避时间（15s/30s/60s/120s）
                        sleep_time = min(15 * (2**attempt), 120) + random.uniform(1, 5)
                        print(
                            f"⏳ 请求频繁，第 {attempt + 1} 次重试，等待 {sleep_time:.1f}s..."
                        )
                    else:
                        sleep_time = delay * (2**attempt) + random.random()
                    time.sleep(sleep_time)
                else:
                    raise e

    def save_load_json(self, json_str: str, _depth: int = 0):
        """解析JSON，支持自动提取<result>标签内容（同步）"""
        if _depth > 3:
            raise ValueError("JSON 修复重试次数过多，请检查 LLM 输出")

        try:
            json_str = self._extract_result_tag(json_str)
        except ValueError:
            pass

        try:
            result = json.loads(json_str)
            # 校验返回类型：如果解析结果是字符串，尝试二次解析（LLM 可能返回了被包裹的 JSON 字符串）
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    raise json.JSONDecodeError("解析结果为字符串而非对象/数组", json_str, 0)
            return result
        except json.JSONDecodeError:
            prompt = get_auto_fix_json_prompt(json_str)
            res = self.generate_text(prompt)
            return self.save_load_json(res, _depth + 1)

    def generate_smart_text(self, prompt: str) -> str:
        """
        智能文本生成（流式，同步）
        """
        stream = self.client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            timeout=3000,
        )

        full_text = ""
        for chunk in stream:
            if chunk.choices and len(chunk.choices) > 0:
                delta = chunk.choices[0].delta
                content = delta.content if hasattr(delta, "content") else None
                if content:
                    print(content, end="", flush=True)
                    full_text += content

        print()
        return full_text

    # ========== 异步方法（新增，用于协程场景） ==========

    async def generate_text_test_async(self, prompt: str) -> str:
        """
        测试：生成结果并返回（非流式，异步非阻塞）
        """
        response = await self.async_client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            timeout=3000,
            **self.custom_params,
        )
        return response.choices[0].message.content

    async def generate_text_async(
        self, prompt: str, retries: int = 5, delay: float = 1.0
    ) -> str:
        """
        异步非阻塞生成文本，带重试。遇到速率限制时使用更长退避时间。
        """
        for attempt in range(retries):
            try:
                response = await self.async_client.chat.completions.create(
                    model=self.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    stream=False,
                    timeout=3000,
                    **self.custom_params,
                )
                full_text = response.choices[0].message.content
                return full_text

            except Exception as e:
                if attempt < retries - 1:
                    if _is_rate_limit_error(e):
                        # 速率限制：使用更长的退避时间（15s/30s/60s/120s）
                        sleep_time = min(15 * (2**attempt), 120) + random.uniform(1, 5)
                        print(
                            f"⏳ 请求频繁，第 {attempt + 1} 次重试，等待 {sleep_time:.1f}s..."
                        )
                    else:
                        sleep_time = delay * (2**attempt) + random.random()
                    await asyncio.sleep(sleep_time)  # 非阻塞等待
                else:
                    raise e

    async def save_load_json_async(self, json_str: str, _depth: int = 0):
        """解析JSON，支持自动提取<result>标签内容（异步版）"""
        if _depth > 3:
            raise ValueError("JSON 修复重试次数过多，请检查 LLM 输出")

        try:
            json_str = self._extract_result_tag(json_str)
        except ValueError:
            pass

        try:
            result = json.loads(json_str)
            # 校验返回类型：如果解析结果是字符串，尝试二次解析（LLM 可能返回了被包裹的 JSON 字符串）
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    raise json.JSONDecodeError("解析结果为字符串而非对象/数组", json_str, 0)
            return result
        except json.JSONDecodeError:
            prompt = get_auto_fix_json_prompt(json_str)
            res = await self.generate_text_async(prompt)
            return await self.save_load_json_async(res, _depth + 1)

    async def generate_smart_text_async(self, prompt: str) -> str:
        """
        智能文本生成（流式，异步非阻塞）
        """
        stream = await self.async_client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            timeout=3000,
        )

        full_text = ""
        async for chunk in stream:
            if chunk.choices and len(chunk.choices) > 0:
                delta = chunk.choices[0].delta
                content = delta.content if hasattr(delta, "content") else None
                if content:
                    full_text += content

        return full_text
