import json
import os
import re
import shutil
from collections import defaultdict
from typing import List

from sqlalchemy import Sequence

from py.core.config import getConfigPath
from py.core.text_correct_engine import TextCorrectorFinal
from py.core.tts_engine import TTSEngine
from py.db.database import SessionLocal
from py.dto.line_dto import LineInitDTO
from py.entity.chapter_entity import ChapterEntity
from py.entity.line_entity import LineEntity
from py.models.po import ChapterPO, RolePO, LinePO

from py.repositories.chapter_repository import ChapterRepository
from py.repositories.line_repository import LineRepository

from py.core.prompts import get_context2lines_prompt, get_add_smart_role_and_voice
from py.repositories.llm_provider_repository import LLMProviderRepository
from py.repositories.project_repository import ProjectRepository
from py.repositories.role_repository import RoleRepository
from py.core.llm_engine import LLMEngine
from py.repositories.voice_repository import VoiceRepository
from py.services.project_service import ProjectService


class ChapterService:

    def __init__(self, repository: ChapterRepository):
        """注入 repository"""
        self.repository = repository

    def create_chapter(self, entity: ChapterEntity):
        """创建新章节
        - 检查同名章节是否存在
        - 如果存在，抛出异常或返回错误
        - 如果没有指定 order_index，尝试从标题中自动提取
        - 调用 repository.create 插入数据库
        """

        chapter = self.repository.get_by_name(entity.title, entity.project_id)
        if chapter:
            print("同名章节已存在")
            return None
        # 自动提取 order_index（如果未指定）
        if entity.order_index is None:
            entity.order_index = ProjectService.extract_order_index(entity.title)
        # 手动将entity转化为po
        po = ChapterPO(**entity.__dict__)
        res = self.repository.create(po)

        # res(po) --> entity
        data = {k: v for k, v in res.__dict__.items() if not k.startswith("_")}
        entity = ChapterEntity(**data)

        # 将po转化为entity
        return entity

    def get_chapter(self, chapter_id: int) -> ChapterEntity | None:
        """根据 ID 查询章节"""
        po = self.repository.get_by_id(chapter_id)
        if not po:
            return None
        data = {k: v for k, v in po.__dict__.items() if not k.startswith("_")}
        res = ChapterEntity(**data)
        return res

    def get_all_chapters(self, project_id: int) -> list[dict]:
        """获取所有章节列表（轻量，含 has_content）"""
        return self.repository.get_all(project_id)

    def get_chapters_page(
        self, project_id: int, page: int = 1, page_size: int = 50, keyword: str = ""
    ) -> tuple:
        """分页查询章节（支持搜索）"""
        return self.repository.get_page(project_id, page, page_size, keyword)

    def get_chapter_position(self, project_id: int, chapter_id: int) -> int | None:
        """查询某个章节在项目有序列表中的位置（从0开始的索引）"""
        return self.repository.get_position(project_id, chapter_id)

    def get_ids_by_range(
        self, project_id: int, start: int, end: int, has_content_only: bool = False
    ) -> list[int]:
        """按排序后的位置范围获取章节 ID 列表（start/end 均为 1-based）"""
        return self.repository.get_ids_by_range(
            project_id, start, end, has_content_only
        )

    def get_ids_by_order_index_range(
        self,
        project_id: int,
        start_order: int,
        end_order: int,
        has_content_only: bool = False,
    ) -> list[int]:
        """按 order_index 值范围获取章节 ID 列表（章节号范围）"""
        return self.repository.get_ids_by_order_index_range(
            project_id, start_order, end_order, has_content_only
        )

    def get_order_index_range(self, project_id: int) -> tuple:
        """获取项目下章节 order_index 的最小值和最大值"""
        return self.repository.get_order_index_range(project_id)

    def fix_order_index(self, project_id: int) -> int:
        """修复项目下所有章节的 order_index：从标题中自动提取章节号
        仅修复 order_index 为 NULL 的章节，返回修复的数量
        """
        chapters = self.repository.get_all(project_id)
        fixed = 0
        for ch in chapters:
            if ch["order_index"] is not None:
                continue
            order_idx = ProjectService.extract_order_index(ch["title"])
            if order_idx is not None:
                self.repository.update(ch["id"], {"order_index": order_idx})
                fixed += 1
        return fixed

    def update_chapter(self, chapter_id: int, data: dict) -> bool:
        """更新章节
        - 可以只更新部分字段
        - 检查同名冲突
        - 检查project_id不能改变
        """
        title = data["title"]
        project_id = data["project_id"]
        if (
            self.repository.get_by_name(title, project_id)
            and self.repository.get_by_name(title, project_id).id != chapter_id
        ):
            return False
        po = self.repository.get_by_id(chapter_id)
        # 防止改变project_id
        if po.project_id != project_id:
            return False
        self.repository.update(chapter_id, data)
        return True

    def delete_chapter(self, chapter_id: int) -> bool:
        """删除章节"""
        db = SessionLocal()
        try:
            chapter = self.repository.get_by_id(chapter_id)

            #     移除资源内容
            # 删除该路径所有内容
            project_repository = ProjectRepository(db)
            project = project_repository.get_by_id(chapter.project_id)
            root_path = project.project_root_path or getConfigPath()
            chapter_path = os.path.join(
                root_path, str(chapter.project_id), str(chapter_id)
            )
            if os.path.exists(chapter_path):
                shutil.rmtree(chapter_path)  # 删除整个文件夹及其所有内容
                print(f"已删除目录及内容: {chapter_path}")
            else:
                print(f"目录不存在: {chapter_path}")
            #     先删除资源，再删除记录
            res = self.repository.delete(chapter_id)
            # 删除章节下所有台词
            line_repository = LineRepository(db)
            line_res = line_repository.delete_all_by_chapter_id(chapter_id)
        finally:
            db.close()
        return res

    # 先获取章节内容
    def split_text(self, chapter_id: int, max_length: int = 1500) -> List[str]:
        """
        将文本按标点/换行断句，并按最大长度分组，确保每段以标点结束。
        支持中英文标点和换行符。
        """
        content = self.get_chapter(chapter_id).text_content
        # 去掉空行
        content = "\n".join([line for line in content.split("\n") if line.strip()])

        # 如果最后没有句号/问号/感叹号/点号，自动补一个句号
        if not re.search(r"[。！？.!?]$", content):
            content += "。"

        # 使用正则分割，支持中英文标点 + 逗号 + 换行
        # [] 里列出所有可能的结束符号
        sentences = re.findall(
            r"[^。！？.!?,，\n]*[。！？.!?,，\n]", content, re.MULTILINE | re.DOTALL
        )

        chunks = []
        buffer = ""

        for sentence in sentences:
            if len(buffer) + len(sentence) <= max_length:
                buffer += sentence
            else:
                if buffer:
                    chunks.append(buffer.strip())
                buffer = sentence

        if buffer:
            chunks.append(buffer.strip())

        return chunks

    # 然后进行划分

    @staticmethod
    def _find_invalid_emotions(
        parsed_data: list, emotion_set: set, strength_set: set
    ) -> list:
        """
        校验 LLM 返回的 parsed_data 中的 emotion_name 和 strength_name 是否合法。
        返回不合法的条目列表 [{"index": i, "text_content": ..., "emotion_name": ..., "strength_name": ...}, ...]
        """
        invalid_items = []
        for i, item in enumerate(parsed_data):
            emo = item.get("emotion_name", "")
            stg = item.get("strength_name", "")
            role = item.get("role_name", "")
            # 旁白统一为平静/中等，不需要校验
            if role == "旁白":
                continue
            if emo not in emotion_set or stg not in strength_set:
                invalid_items.append(
                    {
                        "index": i,
                        "text_content": item.get("text_content", "")[:80],
                        "role_name": role,
                        "emotion_name": emo,
                        "strength_name": stg,
                    }
                )
        return invalid_items

    @staticmethod
    def _sanitize_emotions(
        parsed_data: list,
        emotion_names: list,
        strength_names: list,
        default_emotion: str = "平静",
        default_strength: str = "中等",
    ) -> list:
        """
        最终兜底清洗：确保 parsed_data 中每条数据的 emotion_name 和 strength_name
        一定在合法列表中。对于不合法或缺失的值，强制 fallback 到默认值。
        在构造 LineInitDTO 之前调用，杜绝脏数据入库。
        """
        emotion_set = set(emotion_names) if emotion_names else set()
        strength_set = set(strength_names) if strength_names else set()

        for item in parsed_data:
            emo = (item.get("emotion_name") or "").strip()
            stg = (item.get("strength_name") or "").strip()

            # 情绪不合法或为空 → fallback
            if not emo or emo not in emotion_set:
                item["emotion_name"] = default_emotion
            else:
                item["emotion_name"] = emo  # 写回 strip 后的值

            # 强度不合法或为空 → fallback
            if not stg or stg not in strength_set:
                item["strength_name"] = default_strength
            else:
                item["strength_name"] = stg  # 写回 strip 后的值

        return parsed_data

    @staticmethod
    def _build_emotion_fix_prompt(
        invalid_items: list, emotion_names: list, strength_names: list
    ) -> str:
        """
        构造情绪修正的重试 prompt，让 LLM 仅重新选择合法的情绪和强度。
        返回 prompt 字符串。
        """
        items_desc = ""
        for item in invalid_items:
            items_desc += (
                f'  - 序号 {item["index"]}, 角色: {item["role_name"]}, '
                f'台词片段: "{item["text_content"]}", '
                f'当前情绪: "{item["emotion_name"]}", 当前强度: "{item["strength_name"]}"\n'
            )

        prompt = f"""你之前的输出中，以下台词的情绪或强度不在合法列表中，请重新为它们选择正确的情绪和强度。

不合法的条目：
{items_desc}
合法的情绪列表（只能从中选择）：
【{', '.join(emotion_names)}】

合法的强度列表（只能从中选择）：
【{', '.join(strength_names)}】

请严格输出 JSON 数组，每个元素包含 index、emotion_name、strength_name 三个字段。
不要输出其他任何内容。

示例输出：
[{{"index": 0, "emotion_name": "平静", "strength_name": "中等"}}, {{"index": 3, "emotion_name": "高兴", "strength_name": "较强"}}]
"""
        return prompt

    # 然后循环解析，并保存
    def fill_prompt(
        self,
        template: str,
        characters: list[str],
        emotions: list[str],
        strengths: list[str],
        novel_content: str,
    ) -> str:
        result = template
        result = result.replace("{possible_characters}", ", ".join(characters))
        result = result.replace("{possible_emotions}", ", ".join(emotions))
        result = result.replace("{possible_strengths}", ", ".join(strengths))
        result = result.replace("{novel_content}", novel_content)
        return result

    def para_content(
        self,
        prompt: str,
        chapter_id: int,
        content: str = None,
        role_names: List[str] = None,
        emotion_names: List[str] = None,
        strength_names: List[str] = None,
        is_precise_fill: int = 0,
    ):
        db = SessionLocal()
        try:
            #         获取content
            chapter = self.repository.get_by_id(chapter_id)
            # content = chapter.text_content
            #          获取角色列表
            #         role_repository = RoleRepository(db)
            #         roles = role_repository.get_all(chapter.project_id)
            #         role_names = [role.name for role in roles]
            #         组装prompt
            #         prompt = get_context2lines_prompt(role_names, content,emotion_names,strength_names)
            prompt = self.fill_prompt(
                prompt, role_names, emotion_names, strength_names, content
            )

            #   获取llm_provider

            project_repository = ProjectRepository(db)
            project = project_repository.get_by_id(chapter.project_id)
            llm_provider_id = project.llm_provider_id
            #
            llm_provider_repository = LLMProviderRepository(db)
            llm_provider = llm_provider_repository.get_by_id(llm_provider_id)
            llm = LLMEngine(
                llm_provider.api_key,
                llm_provider.api_base_url,
                project.llm_model,
                llm_provider.custom_params,
            )
            try:
                llm.generate_text_test(
                    "请输出一份用户信息，严格使用 JSON 格式，不要包含任何额外文字。字段包括：name, age, city"
                )
                print("LLM可用")
            except Exception as e:
                print("LLM不可用")
                return {"success": False, "message": f"LLM 不可用: {str(e)}"}
            print("开始内容解析")
            try:
                result = llm.generate_text(prompt)
                # 解析json，并且构造为List[LineInitDTO]
                # 解析 JSON 字符串为 Python 对象
                parsed_data = llm.save_load_json(result)
                if not parsed_data:
                    return {
                        "success": False,
                        "message": "JSON 解析失败或返回空对象",
                    }
                # 校验返回类型：必须是列表
                if not isinstance(parsed_data, list):
                    return {
                        "success": False,
                        "message": f"LLM 返回格式异常，期望数组但得到 {type(parsed_data).__name__}",
                    }
                # 校验列表元素类型：必须是字典
                if parsed_data and not isinstance(parsed_data[0], dict):
                    return {
                        "success": False,
                        "message": f"LLM 返回数组元素格式异常，期望对象但得到 {type(parsed_data[0]).__name__}",
                    }
                # 这里进行自动填充

                if is_precise_fill == 1:
                    print("开始自动填充")
                    corrector = TextCorrectorFinal()
                    parsed_data = corrector.correct_ai_text(content, parsed_data)

                # parsed_data = json.loads(result)
                # 构造 List[LineInitDTO]
                # ---- 情绪校验 + 重试修正 ----
                emotion_set = set(emotion_names) if emotion_names else set()
                strength_set = set(strength_names) if strength_names else set()
                if emotion_set and strength_set:
                    invalid_items = self._find_invalid_emotions(
                        parsed_data, emotion_set, strength_set
                    )
                    if invalid_items:
                        print(f"发现 {len(invalid_items)} 条情绪不合法，尝试修正...")
                        fix_prompt = self._build_emotion_fix_prompt(
                            invalid_items, emotion_names, strength_names
                        )
                        try:
                            fix_result = llm.generate_text(fix_prompt)
                            fix_data = llm.save_load_json(fix_result)
                            if fix_data:
                                for fix_item in fix_data:
                                    idx = fix_item.get("index")
                                    new_emo = fix_item.get("emotion_name", "")
                                    new_stg = fix_item.get("strength_name", "")
                                    if idx is not None and 0 <= idx < len(parsed_data):
                                        if new_emo in emotion_set:
                                            parsed_data[idx]["emotion_name"] = new_emo
                                        else:
                                            parsed_data[idx]["emotion_name"] = "平静"
                                        if new_stg in strength_set:
                                            parsed_data[idx]["strength_name"] = new_stg
                                        else:
                                            parsed_data[idx]["strength_name"] = "中等"
                                print(f"情绪修正完成，修正了 {len(fix_data)} 条")
                            else:
                                # 修正失败，将不合法的情绪 fallback 为平静
                                for item in invalid_items:
                                    idx = item["index"]
                                    if item["emotion_name"] not in emotion_set:
                                        parsed_data[idx]["emotion_name"] = "平静"
                                    if item["strength_name"] not in strength_set:
                                        parsed_data[idx]["strength_name"] = "中等"
                                print("情绪修正LLM返回为空，已fallback为平静")
                        except Exception as fix_e:
                            print(
                                f"情绪修正重试失败: {fix_e}，将不合法情绪fallback为平静"
                            )
                            for item in invalid_items:
                                idx = item["index"]
                                if item["emotion_name"] not in emotion_set:
                                    parsed_data[idx]["emotion_name"] = "平静"
                                if item["strength_name"] not in strength_set:
                                    parsed_data[idx]["strength_name"] = "中等"

                # ---- 最终兜底清洗：确保所有情绪/强度一定合法 ----
                parsed_data = self._sanitize_emotions(
                    parsed_data, emotion_names, strength_names
                )

                line_dtos: List[LineInitDTO] = [
                    LineInitDTO(**item) for item in parsed_data
                ]
                return {"success": True, "data": line_dtos}

            except Exception as e:
                print("调用 LLM 出错：", e)
                return {"success": False, "message": f"调用 LLM 出错: {str(e)}"}
        finally:
            db.close()

    # 导出指令
    # def get_prompt_content(self,project_id, chapter_id,prompt):
    #     db = SessionLocal()
    #     try:
    #         #         获取content
    #         chapter = self.repository.get_by_id(chapter_id)
    #         content = chapter.text_content
    #         #          获取角色列表
    #         role_repository = RoleRepository(db)
    #         roles = role_repository.get_all(chapter.project_id)
    #         role_names = [role.name for role in roles]
    #         #         组装prompt
    #         # 获取project
    #
    #         prompt = self.fill_prompt(prompt, role_names, emotion_names, strength_names, content)
    #         prompt = get_context2lines_prompt(role_names, content)
    #         return  prompt
    #     finally:
    #         db.close()
    def add_smart_role_and_voice(self, project, content, role_names, voice_names):
        # 智能匹配提示词，要写死吗？
        db = SessionLocal()
        try:
            llm_provider_id = project.llm_provider_id
            llm_provider_repository = LLMProviderRepository(db)
            llm_provider = llm_provider_repository.get_by_id(llm_provider_id)
            llm = LLMEngine(
                llm_provider.api_key,
                llm_provider.api_base_url,
                project.llm_model,
                llm_provider.custom_params,
            )
            prompt = get_add_smart_role_and_voice(content, role_names, voice_names)
            result = llm.generate_smart_text(prompt)
            parse_data = llm.save_load_json(result)
            # 获取项目所有音色
            voice_repository = VoiceRepository(db)
            voices = voice_repository.get_all(project.tts_provider_id)
            # map name- id
            voice_id_map = {voice.name: voice.id for voice in voices}

            # 对角色进行update
            role_repository = RoleRepository(db)
            res = []
            for item in parse_data:
                role = role_repository.get_by_name(item["role_name"], project.id)
                if role:
                    if item["voice_name"]:
                        print("更新角色音色：", item["role_name"], item["voice_name"])
                        role_repository.update(
                            role.id,
                            {"default_voice_id": voice_id_map.get(item["voice_name"])},
                        )
                        res.append(
                            {
                                "role_name": item["role_name"],
                                "voice_name": item["voice_name"],
                            }
                        )

            return True, res
        except Exception as e:
            print("LLM智能匹配出错：", e)
            return False, []
        finally:
            db.close()

    # ========== 异步方法（新增，用于协程场景，不阻塞事件循环） ==========

    async def para_content_async(
        self,
        prompt: str,
        chapter_id: int,
        content: str = None,
        role_names: List[str] = None,
        emotion_names: List[str] = None,
        strength_names: List[str] = None,
        is_precise_fill: int = 0,
    ):
        """异步版 LLM 解析章节内容，所有网络 IO 均为非阻塞"""
        db = SessionLocal()
        try:
            chapter = self.repository.get_by_id(chapter_id)
            prompt = self.fill_prompt(
                prompt, role_names, emotion_names, strength_names, content
            )

            project_repository = ProjectRepository(db)
            project = project_repository.get_by_id(chapter.project_id)
            llm_provider_id = project.llm_provider_id

            llm_provider_repository = LLMProviderRepository(db)
            llm_provider = llm_provider_repository.get_by_id(llm_provider_id)
            llm = LLMEngine(
                llm_provider.api_key,
                llm_provider.api_base_url,
                project.llm_model,
                llm_provider.custom_params,
            )
            # 异步测试 LLM 连通性
            try:
                await llm.generate_text_test_async(
                    "请输出一份用户信息，严格使用 JSON 格式，不要包含任何额外文字。字段包括：name, age, city"
                )
                print("LLM可用")
            except Exception as e:
                print("LLM不可用")
                return {"success": False, "message": f"LLM 不可用: {str(e)}"}

            print("开始内容解析（异步）")
            try:
                # 异步非阻塞调用 LLM
                result = await llm.generate_text_async(prompt)
                parsed_data = await llm.save_load_json_async(result)
                if not parsed_data:
                    return {
                        "success": False,
                        "message": "JSON 解析失败或返回空对象",
                    }
                # 校验返回类型：必须是列表
                if not isinstance(parsed_data, list):
                    return {
                        "success": False,
                        "message": f"LLM 返回格式异常，期望数组但得到 {type(parsed_data).__name__}",
                    }
                # 校验列表元素类型：必须是字典
                if parsed_data and not isinstance(parsed_data[0], dict):
                    return {
                        "success": False,
                        "message": f"LLM 返回数组元素格式异常，期望对象但得到 {type(parsed_data[0]).__name__}",
                    }

                if is_precise_fill == 1:
                    print("开始自动填充")
                    corrector = TextCorrectorFinal()
                    parsed_data = corrector.correct_ai_text(content, parsed_data)

                # ---- 情绪校验 + 重试修正（异步版） ----
                emotion_set = set(emotion_names) if emotion_names else set()
                strength_set = set(strength_names) if strength_names else set()
                if emotion_set and strength_set:
                    invalid_items = self._find_invalid_emotions(
                        parsed_data, emotion_set, strength_set
                    )
                    if invalid_items:
                        print(
                            f"发现 {len(invalid_items)} 条情绪不合法，尝试异步修正..."
                        )
                        fix_prompt = self._build_emotion_fix_prompt(
                            invalid_items, emotion_names, strength_names
                        )
                        try:
                            fix_result = await llm.generate_text_async(fix_prompt)
                            fix_data = await llm.save_load_json_async(fix_result)
                            if fix_data:
                                for fix_item in fix_data:
                                    idx = fix_item.get("index")
                                    new_emo = fix_item.get("emotion_name", "")
                                    new_stg = fix_item.get("strength_name", "")
                                    if idx is not None and 0 <= idx < len(parsed_data):
                                        if new_emo in emotion_set:
                                            parsed_data[idx]["emotion_name"] = new_emo
                                        else:
                                            parsed_data[idx]["emotion_name"] = "平静"
                                        if new_stg in strength_set:
                                            parsed_data[idx]["strength_name"] = new_stg
                                        else:
                                            parsed_data[idx]["strength_name"] = "中等"
                                print(f"情绪修正完成，修正了 {len(fix_data)} 条")
                            else:
                                for item in invalid_items:
                                    idx = item["index"]
                                    if item["emotion_name"] not in emotion_set:
                                        parsed_data[idx]["emotion_name"] = "平静"
                                    if item["strength_name"] not in strength_set:
                                        parsed_data[idx]["strength_name"] = "中等"
                                print("情绪修正LLM返回为空，已fallback为平静")
                        except Exception as fix_e:
                            print(
                                f"情绪修正重试失败: {fix_e}，将不合法情绪fallback为平静"
                            )
                            for item in invalid_items:
                                idx = item["index"]
                                if item["emotion_name"] not in emotion_set:
                                    parsed_data[idx]["emotion_name"] = "平静"
                                if item["strength_name"] not in strength_set:
                                    parsed_data[idx]["strength_name"] = "中等"

                # ---- 最终兜底清洗：确保所有情绪/强度一定合法 ----
                parsed_data = self._sanitize_emotions(
                    parsed_data, emotion_names, strength_names
                )

                line_dtos: List[LineInitDTO] = [
                    LineInitDTO(**item) for item in parsed_data
                ]
                return {"success": True, "data": line_dtos}

            except Exception as e:
                print("调用 LLM 出错：", e)
                return {"success": False, "message": f"调用 LLM 出错: {str(e)}"}
        finally:
            db.close()

    async def add_smart_role_and_voice_async(
        self, project, content, role_names, voice_names
    ):
        """异步版智能匹配角色和音色"""
        db = SessionLocal()
        try:
            llm_provider_id = project.llm_provider_id
            llm_provider_repository = LLMProviderRepository(db)
            llm_provider = llm_provider_repository.get_by_id(llm_provider_id)
            llm = LLMEngine(
                llm_provider.api_key,
                llm_provider.api_base_url,
                project.llm_model,
                llm_provider.custom_params,
            )
            prompt = get_add_smart_role_and_voice(content, role_names, voice_names)
            # 异步非阻塞调用 LLM
            result = await llm.generate_smart_text_async(prompt)
            parse_data = await llm.save_load_json_async(result)

            voice_repository = VoiceRepository(db)
            voices = voice_repository.get_all(project.tts_provider_id)
            voice_id_map = {voice.name: voice.id for voice in voices}

            role_repository = RoleRepository(db)
            res = []
            for item in parse_data:
                role = role_repository.get_by_name(item["role_name"], project.id)
                if role:
                    if item["voice_name"]:
                        print("更新角色音色：", item["role_name"], item["voice_name"])
                        role_repository.update(
                            role.id,
                            {"default_voice_id": voice_id_map.get(item["voice_name"])},
                        )
                        res.append(
                            {
                                "role_name": item["role_name"],
                                "voice_name": item["voice_name"],
                            }
                        )

            return True, res
        except Exception as e:
            print("LLM智能匹配出错：", e)
            return False, []
        finally:
            db.close()
