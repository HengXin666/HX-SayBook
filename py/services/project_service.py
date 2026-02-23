import os
import re

from sqlalchemy import Sequence

from py.core.config import getConfigPath
from py.entity.project_entity import ProjectEntity
from py.models.po import ProjectPO

from py.repositories.project_repository import ProjectRepository


class ProjectService:

    def __init__(self, repository: ProjectRepository):
        """注入 repository"""
        self.repository = repository

    def create_project(self, entity: ProjectEntity):
        """创建新项目
        - 检查同名项目是否存在
        - 如果存在，抛出异常或返回错误
        - 调用 repository.create 插入数据库
        """
        project = self.repository.get_by_name(entity.name)
        if project:
            return None, "项目已存在"
        # 如果未指定项目根路径，使用默认数据目录
        if not entity.project_root_path:
            entity.project_root_path = getConfigPath()
        # 判断项目根路径是否存在，不存在则自动创建
        if not os.path.exists(entity.project_root_path):
            os.makedirs(entity.project_root_path, exist_ok=True)
        # 手动将entity转化为po
        po = ProjectPO(**entity.__dict__)
        res = self.repository.create(po)

        # res(po) --> entity
        data = {k: v for k, v in res.__dict__.items() if not k.startswith("_")}
        entity = ProjectEntity(**data)

        # 将po转化为entity
        return entity, "创建成功"

    def get_project(self, project_id: int) -> ProjectEntity | None:
        """根据 ID 查询项目"""
        po = self.repository.get_by_id(project_id)
        if not po:
            return None
        # 兼容旧数据：project_root_path 为空时自动填充默认路径并持久化
        if not po.project_root_path:
            po.project_root_path = getConfigPath()
            self.repository.update(
                project_id, {"project_root_path": po.project_root_path}
            )
        data = {k: v for k, v in po.__dict__.items() if not k.startswith("_")}
        res = ProjectEntity(**data)
        return res

    def get_all_projects(self) -> Sequence[ProjectEntity]:
        """获取所有项目列表"""
        pos = self.repository.get_all()
        # pos -> entities

        entities = [
            ProjectEntity(
                **{k: v for k, v in po.__dict__.items() if not k.startswith("_")}
            )
            for po in pos
        ]
        return entities

    def update_project(self, project_id: int, data: dict) -> bool:
        """更新项目
        - 可以只更新部分字段
        - 检查同名冲突
        """
        name = data["name"]
        if (
            self.repository.get_by_name(name)
            and self.repository.get_by_name(name).id != project_id
        ):
            return False
        self.repository.update(project_id, data)
        return True

    def delete_project(self, project_id: int) -> bool:
        """删除项目
        - 可以添加业务校验，例如项目下有章节是否允许删除
        - 后续需要级联删除所有章节内容
        """
        res = self.repository.delete(project_id)
        return res

    def search_projects(self, keyword: str) -> Sequence[ProjectEntity]:
        """模糊搜索项目"""

    # ---------- 中文数字 → 阿拉伯数字 ----------
    _CN_NUM = {
        '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
        '十': 10, '百': 100, '千': 1000,
    }

    @staticmethod
    def _cn_to_int(cn: str) -> int | None:
        """将中文数字字符串转为整数，如 '一千四百二十二' → 1422"""
        if not cn:
            return None
        # 纯阿拉伯数字
        if cn.isdigit():
            return int(cn)
        result = 0
        temp = 0
        for ch in cn:
            n = ProjectService._CN_NUM.get(ch)
            if n is None:
                return None  # 含无法识别的字符
            if n >= 10:  # 十/百/千
                if temp == 0:
                    temp = 1
                result += temp * n
                temp = 0
            else:
                temp = n
        result += temp
        return result if result > 0 else None

    # ---------- 从标题中提取章节号 ----------
    _ORDER_PATTERN = re.compile(
        r'^第([\d一二三四五六七八九十百千]+)章'
    )

    @staticmethod
    def extract_order_index(title: str) -> int | None:
        """从章节标题中提取章节号（阿拉伯或中文数字）"""
        m = ProjectService._ORDER_PATTERN.match(title)
        if not m:
            return None
        return ProjectService._cn_to_int(m.group(1))

    # 解析content，按照章节
    def parse_content(self, content):
        """解析内容，按照章节"""
        # 正则匹配常见章节格式（支持中英文数字）
        chapter_pattern = re.compile(
            r"(第[\d一二三四五六七八九十百千]+[章回节部卷].*?)(?=\n|$)"
        )
        # 找到所有章节标题位置
        matches = list(chapter_pattern.finditer(content))
        chapters = []
        # 如果没找到章节，直接返回整个文本
        if not matches:
            return chapters

        for i, match in enumerate(matches):
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(content)

            chapter_name = match.group(1).strip()
            chapter_content = content[start:end].strip()
            order_index = self.extract_order_index(chapter_name)
            chapters.append({
                "chapter_name": chapter_name,
                "content": chapter_content,
                "order_index": order_index,
            })
        return chapters
