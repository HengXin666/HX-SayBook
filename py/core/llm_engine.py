# py/core/llm_engine.py
import asyncio
import json

# py/core/llm_engine.py

import re
import time
import random
from openai import OpenAI, AsyncOpenAI

from py.core.prompts import get_auto_fix_json_prompt


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

        # custom_params从string转为dict
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

    def generate_text(self, prompt: str, retries: int = 3, delay: float = 1.0) -> str:
        """
        同步生成文本（保留兼容）
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
                    sleep_time = delay * (2**attempt) + random.random()
                    time.sleep(sleep_time)
                else:
                    raise e

    def save_load_json(self, json_str: str):
        """解析JSON，支持自动提取<result>标签内容（同步）"""
        try:
            json_str = self._extract_result_tag(json_str)
        except ValueError:
            pass

        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            prompt = get_auto_fix_json_prompt(json_str)
            res = self.generate_text(prompt)
            return self.save_load_json(res)

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
        self, prompt: str, retries: int = 3, delay: float = 1.0
    ) -> str:
        """
        异步非阻塞生成文本，带重试
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
                    sleep_time = delay * (2**attempt) + random.random()
                    await asyncio.sleep(sleep_time)  # 非阻塞等待
                else:
                    raise e

    async def save_load_json_async(self, json_str: str):
        """解析JSON，支持自动提取<result>标签内容（异步版）"""
        try:
            json_str = self._extract_result_tag(json_str)
        except ValueError:
            pass

        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            prompt = get_auto_fix_json_prompt(json_str)
            res = await self.generate_text_async(prompt)
            return await self.save_load_json_async(res)

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
