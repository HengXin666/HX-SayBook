import requests
import httpx
from typing import Optional, List
import os


class TTSEngine:
    def __init__(self, base_url: str):
        """
        初始化 TTS 引擎
        :param base_url: TTS 服务的基础 URL，如 http://127.0.0.1:8000
        """
        self.base_url = base_url.rstrip("/")

    # ========== 同步方法（保留兼容） ==========

    def synthesize(
        self,
        text: str,
        filename: str,
        emo_text: Optional[str] = None,
        emo_vector: Optional[List[float]] = None,
        save_path: Optional[str] = None,
        language: Optional[str] = None,
    ) -> bytes:
        """
        调用 /v2/synthesize 接口进行语音合成
        :param text: 要合成的文本
        :param filename: 参考音频文件名（服务端已存在）
        :param emo_text: 情绪文本（可选）
        :param emo_vector: 8维情绪向量（可选，优先级高于 emo_text）
        :param save_path: 如果指定，将保存生成的音频文件到本地
        :param language: 语言 "zh"(中文) / "ja"(日语)，默认自动检测
        :return: 音频二进制数据
        """
        url = f"{self.base_url}/v2/synthesize"

        payload = {"text": text, "audio_path": filename}

        if language:
            payload["language"] = language

        if emo_vector is not None:
            payload["emo_vector"] = emo_vector
        elif emo_text:
            payload["emo_text"] = emo_text

        resp = requests.post(url, json=payload)
        if resp.status_code != 200:
            raise Exception(f"Synthesis failed: {resp.text}")

        audio_bytes = resp.content

        # 验证返回的内容是否为有效音频（WAV 文件以 RIFF 开头）
        self._validate_audio_bytes(audio_bytes)

        if save_path:
            with open(save_path, "wb") as f:
                f.write(audio_bytes)

        return audio_bytes

    def get_models(self) -> dict:
        """
        调用 /v1/models 获取模型列表
        :return: 模型信息
        """
        url = f"{self.base_url}/v1/models"
        resp = requests.get(url)
        resp.raise_for_status()
        return resp.json()

    def check_audio_exists(self, filename: str) -> bool:
        """
        调用 /v1/check/audio 检查参考音频是否存在
        :param filename: 原始文件名
        :return: True or False
        """
        url = f"{self.base_url}/v1/check/audio"
        params = {"file_name": filename}
        resp = requests.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("exists", False)

    def upload_audio(self, file_path: str, full_path=None) -> dict:
        """
        调用 /v1/upload_audio 上传音频
        :param file_path: 本地音频文件路径
        :param full_path: 用于唯一标识的全路径（可选，如果不传则使用 file_path）
        :return: 服务端响应 JSON
        """
        if not os.path.isfile(file_path):
            return {"code": 400, "msg": f"文件不存在: {file_path}"}

        url = f"{self.base_url}/v1/upload_audio"
        try:
            with open(file_path, "rb") as f:
                files = {"audio": (os.path.basename(file_path), f, "audio/wav")}
                # 如果需要额外传 fullpath 参数
                data = {}
                if full_path:
                    data["full_path"] = full_path

                resp = requests.post(url, files=files, data=data, timeout=30)
                resp.raise_for_status()
                return resp.json()
        except requests.exceptions.RequestException as e:
            return {"code": 500, "msg": f"请求失败: {str(e)}"}
        except Exception as e:
            return {"code": 500, "msg": f"上传异常: {str(e)}"}

    # ========== 异步方法（新增，用于协程场景） ==========

    async def synthesize_async(
        self,
        text: str,
        filename: str,
        emo_text: Optional[str] = None,
        emo_vector: Optional[List[float]] = None,
        save_path: Optional[str] = None,
        language: Optional[str] = None,
    ) -> bytes:
        """
        异步调用 /v2/synthesize 接口进行语音合成
        """
        url = f"{self.base_url}/v2/synthesize"
        payload = {"text": text, "audio_path": filename}

        if language:
            payload["language"] = language

        if emo_vector is not None:
            payload["emo_vector"] = emo_vector
        elif emo_text:
            payload["emo_text"] = emo_text

        async with httpx.AsyncClient(timeout=1200) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                raise Exception(f"Synthesis failed: {resp.text}")

            audio_bytes = resp.content

            # 验证返回的内容是否为有效音频（WAV 文件以 RIFF 开头）
            self._validate_audio_bytes(audio_bytes)

            if save_path:
                with open(save_path, "wb") as f:
                    f.write(audio_bytes)

            return audio_bytes

    @staticmethod
    def _validate_audio_bytes(audio_bytes: bytes):
        """
        验证返回的字节数据是否为有效音频文件。
        WAV 文件以 b'RIFF' 开头，如果不是则说明返回了非音频内容（如 HTML 错误页面）。
        """
        if not audio_bytes or len(audio_bytes) < 44:
            raise Exception("TTS 合成失败: 返回数据为空或过短，不是有效的音频文件")

        # WAV 格式以 RIFF 开头
        if audio_bytes[:4] == b'RIFF':
            return

        # 可能是其他音频格式（如 MP3 以 ID3 或 \xff\xfb 开头，FLAC 以 fLaC 开头）
        if audio_bytes[:3] == b'ID3' or audio_bytes[:2] == b'\xff\xfb' or audio_bytes[:4] == b'fLaC':
            return

        # 尝试检测是否为 HTML 内容
        content_start = audio_bytes[:200].strip()
        if content_start.startswith(b'<') or b'<!DOCTYPE' in content_start or b'<html' in content_start:
            # 尝试解码为文本获取错误信息
            try:
                text_hint = audio_bytes[:500].decode('utf-8', errors='replace')
            except Exception:
                text_hint = '(无法解码)'
            raise Exception(f"TTS 合成失败: 返回了 HTML 页面而非音频数据，可能是网关/代理错误。内容片段: {text_hint[:200]}")

        raise Exception(
            f"TTS 合成失败: 返回数据不是有效的音频格式 "
            f"(前4字节: {audio_bytes[:4].hex()}, 大小: {len(audio_bytes)} 字节)"
        )

    async def check_audio_exists_async(self, filename: str) -> bool:
        """
        异步检查参考音频是否存在
        """
        url = f"{self.base_url}/v1/check/audio"
        params = {"file_name": filename}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json().get("exists", False)

    async def upload_audio_async(self, file_path: str, full_path=None) -> dict:
        """
        异步上传音频
        """
        if not os.path.isfile(file_path):
            return {"code": 400, "msg": f"文件不存在: {file_path}"}

        url = f"{self.base_url}/v1/upload_audio"
        try:
            with open(file_path, "rb") as f:
                files = {"audio": (os.path.basename(file_path), f, "audio/wav")}
                data = {}
                if full_path:
                    data["full_path"] = full_path

                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(url, files=files, data=data)
                    resp.raise_for_status()
                    return resp.json()
        except httpx.HTTPError as e:
            return {"code": 500, "msg": f"请求失败: {str(e)}"}
        except Exception as e:
            return {"code": 500, "msg": f"上传异常: {str(e)}"}


class MultiTTSEngine:
    """
    多端点 TTS 引擎：支持逗号分隔的多个 api_base_url，内部 round-robin 轮询分发。

    使用方式:
        engine = MultiTTSEngine("http://host1:8000, http://host2:8000")
        # 单条合成 —— 自动轮询选择一个实例
        engine.synthesize(text, filename, ...)
        # 异步合成 —— 自动轮询
        await engine.synthesize_async(text, filename, ...)

    当只有一个地址时，行为等价于 TTSEngine（零开销）。
    """

    def __init__(self, base_urls: str):
        """
        :param base_urls: 逗号分隔的多个 TTS 服务地址，如 "http://a:8000, http://b:8000"
        """
        urls = [u.strip() for u in base_urls.split(",") if u.strip()]
        if not urls:
            raise ValueError("至少需要一个 TTS 服务地址")
        self._engines = [TTSEngine(u) for u in urls]
        self._count = len(self._engines)
        self._index = 0  # round-robin 游标
        import threading
        self._lock = threading.Lock()

    @property
    def engine_count(self) -> int:
        """返回可用 TTS 实例数量"""
        return self._count

    def _next_engine(self) -> TTSEngine:
        """线程安全的 round-robin 选择下一个引擎"""
        with self._lock:
            engine = self._engines[self._index % self._count]
            self._index += 1
            return engine

    # ========== 代理同步方法 ==========

    def synthesize(self, text, filename, emo_text=None, emo_vector=None, save_path=None, language=None) -> bytes:
        engine = self._next_engine()
        return engine.synthesize(text, filename, emo_text, emo_vector, save_path, language)

    def check_audio_exists(self, filename: str) -> bool:
        """检查任意一个实例上音频是否存在（检查第一个实例即可）"""
        return self._engines[0].check_audio_exists(filename)

    def upload_audio(self, file_path: str, full_path=None) -> dict:
        """上传音频到所有实例（确保每个实例都有参考音频）"""
        results = []
        for engine in self._engines:
            results.append(engine.upload_audio(file_path, full_path))
        return results[-1]  # 返回最后一个结果

    def get_models(self) -> dict:
        return self._engines[0].get_models()

    # ========== 代理异步方法 ==========

    async def synthesize_async(self, text, filename, emo_text=None, emo_vector=None, save_path=None, language=None) -> bytes:
        engine = self._next_engine()
        return await engine.synthesize_async(text, filename, emo_text, emo_vector, save_path, language)

    async def check_audio_exists_async(self, filename: str) -> bool:
        return await self._engines[0].check_audio_exists_async(filename)

    async def upload_audio_async(self, file_path: str, full_path=None) -> dict:
        """异步上传音频到所有实例"""
        import asyncio
        tasks = [engine.upload_audio_async(file_path, full_path) for engine in self._engines]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        # 返回最后一个成功的结果
        for r in reversed(results):
            if not isinstance(r, Exception):
                return r
        raise results[0]  # 全部失败则抛出第一个异常

    async def ensure_all_uploaded_async(self, file_path: str, full_path=None):
        """确保所有实例都已上传该参考音频（异步并发检查+上传）"""
        import asyncio

        async def _ensure_single(engine: TTSEngine):
            exists = await engine.check_audio_exists_async(full_path or file_path)
            if not exists:
                await engine.upload_audio_async(file_path, full_path)

        tasks = [_ensure_single(e) for e in self._engines]
        await asyncio.gather(*tasks, return_exceptions=True)

    def ensure_all_uploaded(self, file_path: str, full_path=None):
        """确保所有实例都已上传该参考音频（同步版本，用于预上传）"""
        for engine in self._engines:
            if not engine.check_audio_exists(full_path or file_path):
                engine.upload_audio(file_path, full_path)


if __name__ == "__main__":
    # 示例使用
    engine = TTSEngine("https://eihh5fmon4-8200.cnb.run/")

    # 1. 上传音频
    upload_res = engine.upload_audio(
        "C:\\Users\\lxc18\\Music\\多情绪\\吴泽\\解说\\中等.wav",
        full_path="C:\\Users\\lxc18\\Music\\多情绪\\吴泽\\解说\\中等.wav",
    )
    # print("上传结果:", upload_res)

    # 2. 检查音频是否存在
    exists = engine.check_audio_exists(
        "C:\\Users\\lxc18\\Music\\多情绪\\吴泽\\解说\\中等.wav"
    )
    print("音频存在:", exists)

    # 3. 获取模型列表
    models = engine.get_models()
    print("模型信息:", models)

    # 4. 合成语音
    if exists:
        audio = engine.synthesize(
            "萧炎，斗之力，三段！级别：低级！",
            "C:\\Users\\lxc18\\Music\\多情绪\\吴泽\\解说\\中等.wav",
            emo_text="愤怒",
            save_path="output.wav",
        )
        print(f"语音已保存到 output.wav, 大小 {len(audio)} 字节")
