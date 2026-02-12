import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { voiceApi } from '../api';
import { useAppStore } from '../store';
import type { Voice } from '../types';

const { Title, Text } = Typography;

export default function VoiceManager() {
  const { voices, fetchVoices, ttsProviders, fetchTTSProviders } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editVoice, setEditVoice] = useState<Voice | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchVoices();
    fetchTTSProviders();
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editVoice) {
        await voiceApi.update(editVoice.id, values);
        message.success('音色更新成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditVoice(null);
      fetchVoices();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    await voiceApi.delete(id);
    message.success('已删除');
    fetchVoices();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '多情绪', dataIndex: 'is_multi_emotion', key: 'is_multi_emotion', width: 80,
      render: (v: number) => <Tag color={v === 1 ? 'green' : 'default'}>{v === 1 ? '是' : '否'}</Tag>,
    },
    {
      title: '参考音频', dataIndex: 'reference_path', key: 'reference_path', ellipsis: true,
      render: (v: string) => v ? <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> : '-',
    },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: unknown, record: Voice) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditVoice(record); form.setFieldsValue(record); setModalOpen(true); }} />
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
        <Title level={3} style={{ margin: 0, color: '#cdd6f4' }}>🎵 音色管理</Title>
      </div>

      <Card style={{ background: '#1e1e2e', borderColor: '#313244' }}>
        <Table dataSource={voices} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 20 }} />
      </Card>

      <Modal title={editVoice ? '编辑音色' : '新增音色'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="reference_path" label="参考音频路径"><Input placeholder="音频文件路径" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
