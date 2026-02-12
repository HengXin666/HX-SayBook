import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { promptApi } from '../api';
import { useAppStore } from '../store';
import type { Prompt } from '../types';

const { Title, Text } = Typography;

export default function PromptManager() {
  const { prompts, fetchPrompts } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState<Prompt | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchPrompts();
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editPrompt) {
        await promptApi.update(editPrompt.id, values);
        message.success('更新成功');
      } else {
        await promptApi.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditPrompt(null);
      fetchPrompts();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    await promptApi.delete(id);
    message.success('已删除');
    fetchPrompts();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '任务', dataIndex: 'task', key: 'task' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: unknown, record: Prompt) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditPrompt(record); form.setFieldsValue(record); setModalOpen(true); }} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, color: '#cdd6f4' }}>📝 提示词管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditPrompt(null); form.resetFields(); setModalOpen(true); }}>
          新增提示词
        </Button>
      </div>

      <Card style={{ background: '#1e1e2e', borderColor: '#313244' }}>
        <Table dataSource={prompts} columns={columns} rowKey="id" size="small" pagination={false} />
      </Card>

      <Modal title={editPrompt ? '编辑提示词' : '新增提示词'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} width={800}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="提示词名称" /></Form.Item>
          <Form.Item name="task" label="任务类型" rules={[{ required: true }]}><Input placeholder="如: split_lines" /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="提示词描述" /></Form.Item>
          <Form.Item name="content" label="提示词内容">
            <Input.TextArea rows={15} placeholder="输入完整的提示词内容..." style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
