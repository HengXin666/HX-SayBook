import requests
from sqlalchemy import Sequence

from py.entity.tts_provider_entity import TTSProviderEntity
from py.models.po import TTSProviderPO
from py.repositories.tts_provider_repository import TTSProviderRepository


class TTSProviderService:

    def __init__(self, repository: TTSProviderRepository):
        """注入 repository"""
        self.repository = repository

    def get_all_tts_providers(self) -> list[TTSProviderEntity]:
        """查询所有tts供应商"""
        pos = self.repository.get_all()
        res = [
            TTSProviderEntity(
                **{k: v for k, v in po.__dict__.items() if not k.startswith("_")}
            )
            for po in pos
        ]
        return res

    def get_tts_provider(self, tts_provider_id: int) -> TTSProviderEntity | None:
        """根据 ID 查询tts供应商"""
        po = self.repository.get_by_id(tts_provider_id)
        if not po:
            return None
        data = {k: v for k, v in po.__dict__.items() if not k.startswith("_")}
        res = TTSProviderEntity(**data)
        return res

    def update_tts_provider(self, tts_provider_id: int, data: dict) -> bool:
        """更新tts供应商
        - 可以只更新部分字段
        - 检查同名冲突
        - 检查project_id不能改变
        """
        name = data["name"]
        if (
            self.repository.get_by_name(name)
            and self.repository.get_by_name(name).id != tts_provider_id
        ):
            return False
        self.repository.update(tts_provider_id, data)
        return True

    def delete_tts_provider(self, tts_provider_id: int) -> bool:
        """删除tts供应商"""
        res = self.repository.delete(tts_provider_id)
        return res

    def create_default_tts_provider(self):
        """创建默认的tts供应商"""
        if self.repository.get_by_name("index_tts"):
            return
        if self.repository.get_by_id(1):
            return
        po = TTSProviderPO(
            name="index_tts", id=1, status=1, api_base_url="", api_key=""
        )
        self.repository.create(po)

    def create_default_lux_tts_provider(self):
        """创建默认的 LuxTTS (ZipVoice) 供应商
        LuxTTS 是基于 ZipVoice 的轻量级 TTS 引擎，显存占用约 1GB，
        API 接口与 Index-TTS 完全兼容，可无缝切换。
        """
        if self.repository.get_by_name("lux_tts"):
            return
        if self.repository.get_by_id(2):
            return
        po = TTSProviderPO(
            name="lux_tts", id=2, status=1, api_base_url="", api_key=""
        )
        self.repository.create(po)

    def _test_single_url(self, url: str) -> tuple[bool, str]:
        """测试单个 TTS 端点连接"""
        url = url.rstrip("/")
        try:
            resp = requests.get(url, timeout=5)
            if 200 <= resp.status_code < 400:
                try:
                    data = resp.json()
                    if "endpoints" in data:
                        return True, "连接成功"
                    else:
                        return False, (
                            f"响应中缺少 'endpoints' 字段，"
                            f"请确认填写的是根路径（如 http://localhost:8000）"
                        )
                except ValueError:
                    return False, f"响应不是有效的 JSON"
            else:
                return False, f"HTTP {resp.status_code}"
        except requests.exceptions.ConnectionError:
            return False, f"无法连接，请检查服务是否已启动"
        except requests.exceptions.Timeout:
            return False, f"连接超时（5秒）"
        except Exception as e:
            return False, f"异常: {str(e)}"

    def test_tts_provider(self, entity: TTSProviderEntity) -> tuple[bool, str]:
        """测试 TTS 供应商连接，支持逗号分隔的多个地址，返回 (是否成功, 消息)"""
        api_base_url = entity.api_base_url
        if not api_base_url:
            return False, "API 地址为空，请先填写 API 地址"

        # 解析多个地址（逗号分隔）
        urls = [u.strip() for u in api_base_url.split(",") if u.strip()]
        if not urls:
            return False, "API 地址为空，请先填写 API 地址"

        # 单地址：直接测试
        if len(urls) == 1:
            success, msg = self._test_single_url(urls[0])
            if success:
                return True, "测试成功"
            else:
                return False, f"{urls[0]}: {msg}"

        # 多地址：逐个测试，汇总结果
        results = []
        all_ok = True
        for url in urls:
            ok, msg = self._test_single_url(url)
            results.append(f"{'✅' if ok else '❌'} {url}: {msg}")
            if not ok:
                all_ok = False

        summary = "\n".join(results)
        if all_ok:
            return True, f"全部 {len(urls)} 个端点测试成功\n{summary}"
        else:
            ok_count = sum(1 for url in urls if self._test_single_url(url)[0])
            return False, f"{ok_count}/{len(urls)} 个端点可用\n{summary}"
