import { ApiOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, message, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { llmProviderApi, ttsProviderApi } from '../api';
import { useAppStore } from '../store';
import type { LLMProvider, TTSProvider } from '../types';

const { Title } = Typography;

export default function ConfigCenter() {
  const { llmProviders, ttsProviders, fetchLLMProviders, fetchTTSProviders } = useAppStore();
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [ttsModalOpen, setTtsModalOpen] = useState(false);
  const [editLLM, setEditLLM] = useState<LLMProvider | null>(null);
  const [editTTS, setEditTTS] = useState<TTSProvider | null>(null);
  const [llmForm] = Form.useForm();
  const [ttsForm] = Form.useForm();
  const [testingLLM, setTestingLLM] = useState(false);
  const [testingTTS, setTestingTTS] = useState(false);

  useEffect(() => {
    fetchLLMProviders();
    fetchTTSProviders();
  }, []);

  // LLM CRUD
  const handleSaveLLM = async () => {
    try {
      const values = await llmForm.validateFields();
      if (editLLM) {
        await llmProviderApi.update(editLLM.id, values);
        message.success('LLM 更新成功');
      } else {
        await llmProviderApi.create(values);
        message.success('LLM 创建成功');
      }
      setLlmModalOpen(false);
      llmForm.resetFields();
      setEditLLM(null);
      fetchLLMProviders();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteLLM = async (id: number) => {
    await llmProviderApi.delete(id);
    message.success('已删除');
    fetchLLMProviders();
  };

  // LLM 测试连接
  const handleTestLLM = async () => {
    try {
      const values = await llmForm.validateFields();
      setTestingLLM(true);
      const res = await llmProviderApi.test(values);
      if (res.code === 200) {
        message.success('LLM 连接测试成功 ✅');
      } else {
        message.error(`测试失败：${res.message || '未知错误'}`);
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '请求异常';
      message.error(`测试失败：${errMsg}`);
    } finally {
      setTestingLLM(false);
    }
  };

  // TTS CRUD
  const handleSaveTTS = async () => {
    try {
      const values = await ttsForm.validateFields();
      if (editTTS) {
        await ttsProviderApi.update(editTTS.id, values);
        message.success('TTS 更新成功');
      } else {
        await ttsProviderApi.create(values);
        message.success('TTS 创建成功');
      }
      setTtsModalOpen(false);
      ttsForm.resetFields();
      setEditTTS(null);
      fetchTTSProviders();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteTTS = async (id: number) => {
    await ttsProviderApi.delete(id);
    message.success('已删除');
    fetchTTSProviders();
  };

  // TTS 测试连接
  const handleTestTTS = async () => {
    try {
      const values = await ttsForm.validateFields();
      setTestingTTS(true);
      const res = await ttsProviderApi.test(values);
      if (res.code === 200) {
        message.success(res.message || 'TTS 连接测试成功 ✅');
      } else {
        message.error(`测试失败：${res.message || '未知错误'}`);
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '请求异常';
      message.error(`测试失败：${errMsg}`);
    } finally {
      setTestingTTS(false);
    }
  };

  const llmColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'API 地址', dataIndex: 'api_base_url', key: 'api_base_url', ellipsis: true },
    {
      title: '模型列表', dataIndex: 'model_list', key: 'model_list', ellipsis: true,
      render: (v: string | null) => v || <Tag color="default">未配置</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: unknown, record: LLMProvider) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditLLM(record); llmForm.setFieldsValue(record); setLlmModalOpen(true); }} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDeleteLLM(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ttsColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: 'API 地址', dataIndex: 'api_base_url', key: 'api_base_url', ellipsis: true,
      render: (v: string) => {
        const urls = v ? v.split(',').map((u: string) => u.trim()).filter(Boolean) : [];
        return (
          <Space direction="vertical" size={0}>
            <span>{urls[0] || '-'}</span>
            {urls.length > 1 && <Tag color="blue" style={{ marginTop: 2 }}>共 {urls.length} 个端点（{urls.length}x 并发）</Tag>}
          </Space>
        );
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: unknown, record: TTSProvider) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditTTS(record); ttsForm.setFieldsValue(record); setTtsModalOpen(true); }} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDeleteTTS(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ color: '#cdd6f4', marginBottom: 24 }}>⚙️ 配置中心</Title>

      <Tabs
        defaultActiveKey="llm"
        items={[
          {
            key: 'llm',
            label: '🤖 LLM 配置',
            children: (
              <Card style={{ background: '#1e1e2e', borderColor: '#313244' }}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditLLM(null); llmForm.resetFields(); setLlmModalOpen(true); }}>新增 LLM</Button>}>
                <Table dataSource={llmProviders} columns={llmColumns} rowKey="id" size="small" pagination={false} />
              </Card>
            ),
          },
          {
            key: 'tts',
            label: '🎵 TTS 配置',
            children: (
              <Card style={{ background: '#1e1e2e', borderColor: '#313244' }}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditTTS(null); ttsForm.resetFields(); setTtsModalOpen(true); }}>新增 TTS</Button>}>
                <Table dataSource={ttsProviders} columns={ttsColumns} rowKey="id" size="small" pagination={false} />
              </Card>
            ),
          },
        ]}
      />

      {/* LLM Modal */}
      <Modal
        title={editLLM ? '编辑 LLM' : '新增 LLM'}
        open={llmModalOpen}
        onCancel={() => setLlmModalOpen(false)}
        footer={[
          <Button key="test" icon={<ApiOutlined />} loading={testingLLM} onClick={handleTestLLM}>
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => setLlmModalOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={handleSaveLLM}>确定</Button>,
        ]}
      >
        <Form form={llmForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="如: OpenAI" /></Form.Item>
          <Form.Item name="api_base_url" label="API 地址" rules={[{ required: true }]}><Input placeholder="https://api.openai.com/v1" /></Form.Item>
          <Form.Item name="api_key" label="API Key"><Input.Password placeholder="sk-..." /></Form.Item>
          <Form.Item name="model_list" label="模型列表" tooltip="多个模型用英文逗号分隔，如: gpt-4,gpt-3.5-turbo">
            <Input placeholder="gpt-4,gpt-3.5-turbo（逗号分隔）" />
          </Form.Item>
          <Form.Item name="custom_params" label="自定义参数 (JSON)">
            <Input.TextArea rows={4} placeholder='{"temperature": 0.7, "top_p": 0.9}' />
          </Form.Item>
        </Form>
      </Modal>

      {/* TTS Modal */}
      <Modal
        title={editTTS ? '编辑 TTS' : '新增 TTS'}
        open={ttsModalOpen}
        onCancel={() => setTtsModalOpen(false)}
        footer={[
          <Button key="test" icon={<ApiOutlined />} loading={testingTTS} onClick={handleTestTTS}>
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => setTtsModalOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={handleSaveTTS}>确定</Button>,
        ]}
      >
        <Form form={ttsForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="如: Index-TTS" /></Form.Item>
          <Form.Item
            name="api_base_url"
            label="API 地址"
            rules={[{ required: true }]}
            tooltip="填写多个地址（逗号分隔）可启用并发 TTS，显著加速批量配音"
            extra={
              <span style={{ color: '#6c7086', fontSize: 12 }}>
                💡 多个实例用英文逗号分隔，如：http://host1:8000, http://host2:8000
              </span>
            }
          >
            <Input.TextArea
              rows={2}
              placeholder={"http://127.0.0.1:8000\n多个地址用英文逗号分隔，可实现并发加速"}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.api_base_url !== cur.api_base_url}>
            {() => {
              const val = ttsForm.getFieldValue('api_base_url') || '';
              const urls = val.split(',').map((u: string) => u.trim()).filter(Boolean);
              if (urls.length > 1) {
                return (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={`已配置 ${urls.length} 个 TTS 端点，批量配音将以 ${urls.length}x 并发执行`}
                    description={
                      <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                        {urls.map((u: string, i: number) => <li key={i}>{u}</li>)}
                      </ul>
                    }
                  />
                );
              }
              return null;
            }}
          </Form.Item>
          <Form.Item name="api_key" label="API Key"><Input.Password placeholder="可选" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
