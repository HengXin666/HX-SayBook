from typing import Optional, Sequence

from sqlalchemy import select, func, case, and_
from sqlalchemy.orm import Session

from py.models.po import ChapterPO


class ChapterRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, chapter_id: int) -> Optional[ChapterPO]:
        """根据 ID 查询项目"""
        return self.db.get(ChapterPO, chapter_id)

    def get_all(self, project_id: int) -> list[dict]:
        """获取指定项目下的所有章节（不加载 text_content，返回 dict 包含 has_content）"""
        has_content_expr = case(
            (
                and_(ChapterPO.text_content.isnot(None), ChapterPO.text_content != ""),
                True,
            ),
            else_=False,
        ).label("has_content")
        stmt = (
            select(
                ChapterPO.id,
                ChapterPO.project_id,
                ChapterPO.title,
                ChapterPO.order_index,
                has_content_expr,
                ChapterPO.created_at,
                ChapterPO.updated_at,
            )
            .where(ChapterPO.project_id == project_id)
            .order_by(ChapterPO.order_index.asc().nullslast(), ChapterPO.id.asc())
        )
        rows = self.db.execute(stmt).all()
        return [
            {
                "id": row.id,
                "project_id": row.project_id,
                "title": row.title,
                "order_index": row.order_index,
                "has_content": bool(row.has_content),
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in rows
        ]

    def get_page(
        self, project_id: int, page: int = 1, page_size: int = 50, keyword: str = ""
    ) -> tuple[list[dict], int]:
        """分页查询章节（不加载 text_content），支持关键词搜索"""
        has_content_expr = case(
            (
                and_(ChapterPO.text_content.isnot(None), ChapterPO.text_content != ""),
                True,
            ),
            else_=False,
        ).label("has_content")
        base = select(
            ChapterPO.id,
            ChapterPO.project_id,
            ChapterPO.title,
            ChapterPO.order_index,
            has_content_expr,
            ChapterPO.created_at,
            ChapterPO.updated_at,
        ).where(ChapterPO.project_id == project_id)

        count_base = select(func.count(ChapterPO.id)).where(
            ChapterPO.project_id == project_id
        )

        if keyword:
            base = base.where(ChapterPO.title.ilike(f"%{keyword}%"))
            count_base = count_base.where(ChapterPO.title.ilike(f"%{keyword}%"))

        total = self.db.execute(count_base).scalar() or 0

        stmt = (
            base.order_by(ChapterPO.order_index.asc().nullslast(), ChapterPO.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        rows = self.db.execute(stmt).all()

        results = [
            {
                "id": row.id,
                "project_id": row.project_id,
                "title": row.title,
                "order_index": row.order_index,
                "has_content": bool(row.has_content),
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in rows
        ]
        return results, total

    def get_position(self, project_id: int, chapter_id: int) -> int | None:
        """查询某个章节在项目有序列表中的位置（从0开始的索引）"""
        # 先获取目标章节的排序信息
        target = self.db.get(ChapterPO, chapter_id)
        if not target or target.project_id != project_id:
            return None
        # 统计排在它前面的章节数量（就是它的索引）
        # 排序规则：order_index ASC NULLS LAST, id ASC
        conditions = [ChapterPO.project_id == project_id]
        if target.order_index is not None:
            conditions.append(
                (ChapterPO.order_index.isnot(None))
                & (
                    (ChapterPO.order_index < target.order_index)
                    | (
                        (ChapterPO.order_index == target.order_index)
                        & (ChapterPO.id < target.id)
                    )
                )
            )
        else:
            # order_index 为 NULL 的排在最后，在 NULL 组内按 id 排序
            conditions.append(
                (ChapterPO.order_index.isnot(None))
                | ((ChapterPO.order_index.is_(None)) & (ChapterPO.id < target.id))
            )
        stmt = select(func.count(ChapterPO.id)).where(*conditions)
        return self.db.execute(stmt).scalar() or 0

    def create(self, chapter_data: ChapterPO) -> ChapterPO:
        """新建项目"""
        self.db.add(chapter_data)
        self.db.commit()
        self.db.refresh(chapter_data)
        return chapter_data

    def update(self, chapter_id: int, chapter_data: dict) -> Optional[ChapterPO]:
        """更新项目"""
        chapter = self.get_by_id(chapter_id)
        if not chapter:
            return None
        for key, value in chapter_data.items():
            if value is not None:  # 只更新不为空的字段
                setattr(chapter, key, value)

        self.db.commit()
        self.db.refresh(chapter)
        return chapter

    def delete(self, chapter_id: int) -> bool:
        """删除章节"""
        project = self.get_by_id(chapter_id)
        if not project:
            return False
        self.db.delete(project)
        self.db.commit()
        return True

    # def delete_all_by_project_id(self, project_id: int) -> bool:
    #     """删除指定项目下的所有章节"""
    #     pos = self.get_all(project_id)
    #     for po in pos:
    #         self.db.delete(po)
    #     self.db.commit()
    #     return True

    def get_by_name(self, name: str, project_id: int) -> Optional[ChapterPO]:
        """根据项目ID和章节名称查找章节"""
        stmt = (
            select(ChapterPO)
            .where(ChapterPO.title == name)
            .where(ChapterPO.project_id == project_id)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def search(self, keyword: str) -> Sequence[ChapterPO]:
        """模糊搜索"""
        stmt = select(ChapterPO).where(ChapterPO.title.ilike(f"%{keyword}%"))
        return self.db.execute(stmt).scalars().all()
