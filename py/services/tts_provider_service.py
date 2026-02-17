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

    def test_tts_provider(self, entity: TTSProviderEntity) -> tuple[bool, str]:
        """测试 TTS 供应商连接，返回 (是否成功, 消息)"""
        api_base_url = entity.api_base_url
        if not api_base_url:
            return False, "API 地址为空，请先填写 API 地址"

        # 确保请求的是根路径（用于连接测试）
        url = api_base_url.rstrip("/")

        try:
            resp = requests.get(url, timeout=5)

            if 200 <= resp.status_code < 400:
                try:
                    data = resp.json()
                    if "endpoints" in data:
                        return True, "测试成功"
                    else:
                        return False, (
                            f"连接成功但响应中缺少 'endpoints' 字段，"
                            f"请确认 API 地址填写的是根路径（如 http://localhost:8000），"
                            f"而非子路径。实际响应: {str(data)[:200]}"
                        )
                except ValueError:
                    return False, (
                        f"连接成功但响应不是有效的 JSON，"
                        f"请确认 API 地址是否正确。响应内容: {resp.text[:200]}"
                    )
            else:
                return False, f"连接失败，HTTP 状态码: {resp.status_code}"

        except requests.exceptions.ConnectionError:
            return False, (
                f"无法连接到 {url}，请检查：\n"
                f"1. Index-TTS API 服务是否已启动\n"
                f"2. 地址和端口是否正确\n"
                f"3. 防火墙是否阻止了连接"
            )
        except requests.exceptions.Timeout:
            return False, f"连接超时（5秒），请检查 API 服务 {url} 是否可达"
        except Exception as e:
            return False, f"测试异常: {str(e)}"
