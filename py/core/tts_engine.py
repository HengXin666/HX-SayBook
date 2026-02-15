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

            if save_path:
                with open(save_path, "wb") as f:
                    f.write(audio_bytes)

            return audio_bytes

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
