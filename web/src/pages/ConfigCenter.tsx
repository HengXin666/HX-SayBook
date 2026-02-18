import { ApiOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ImportOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography } from 'antd';
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
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');

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
      // 将 urls 数组转为逗号分隔的字符串存储
      const urls: string[] = (values.urls || []).map((item: { url: string }) => item.url?.trim()).filter(Boolean);
      const payload = {
        name: values.name,
        api_base_url: urls.join(', '),
        api_key: values.api_key,
      };
      if (editTTS) {
        await ttsProviderApi.update(editTTS.id, payload);
        message.success('TTS 更新成功');
      } else {
        await ttsProviderApi.create(payload);
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

  // 打开 TTS 编辑弹窗时，将逗号分隔的 api_base_url 转为 urls 数组
  const openTTSModal = (record?: TTSProvider) => {
    if (record) {
      setEditTTS(record);
      const urls = record.api_base_url
        ? record.api_base_url.split(',').map((u: string) => u.trim()).filter(Boolean)
        : [''];
      ttsForm.setFieldsValue({
        name: record.name,
        api_key: record.api_key,
        urls: urls.map((url: string) => ({ url })),
      });
    } else {
      setEditTTS(null);
      ttsForm.resetFields();
      ttsForm.setFieldsValue({ urls: [{ url: '' }] });
    }
    setTtsModalOpen(true);
  };

  const handleDeleteTTS = async (id: number) => {
    await ttsProviderApi.delete(id);
    message.success('已删除');
    fetchTTSProviders();
  };

  // 一键导入 TTS 链接（解析多行 URL 填入表单）
  const handleImportUrls = () => {
    const lines = importText
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter((line) => line && (line.startsWith('http://') || line.startsWith('https://')));
    if (lines.length === 0) {
      message.warning('未识别到有效的 URL（需以 http:// 或 https:// 开头）');
      return;
    }
    // 将解析出的 URL 设置到表单的 urls 字段
    ttsForm.setFieldsValue({
      urls: lines.map((url) => ({ url })),
    });
    setImportModalOpen(false);
    setImportText('');
    message.success(`已导入 ${lines.length} 个 TTS 端点`);
  };

  // 一键复制所有 TTS URL
  const handleCopyAllUrls = () => {
    const allUrls = ttsProviders
      .map((p) => p.api_base_url || '')
      .join(',')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (allUrls.length === 0) {
      message.warning('当前没有已配置的 TTS URL');
      return;
    }
    const text = allUrls.join('\n');
    navigator.clipboard.writeText(text).then(
      () => message.success(`已复制 ${allUrls.length} 个 TTS URL 到剪贴板`),
      () => message.error('复制失败，请手动复制'),
    );
  };

  // TTS 测试连接
  const handleTestTTS = async () => {
    try {
      const values = await ttsForm.validateFields();
      setTestingTTS(true);
      // 将 urls 数组转为逗号分隔字符串提交测试
      const urls: string[] = (values.urls || []).map((item: { url: string }) => item.url?.trim()).filter(Boolean);
      const payload = {
        name: values.name,
        api_base_url: urls.join(', '),
        api_key: values.api_key,
      };
      const res = await ttsProviderApi.test(payload);
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openTTSModal(record)} />
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
                extra={
                  <Space>
                    <Button icon={<CopyOutlined />} onClick={handleCopyAllUrls}>复制所有 URL</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openTTSModal()}>新增 TTS</Button>
                  </Space>
                }>
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
          <Form.List name="urls" initialValue={[{ url: '' }]}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8 }}>
                  <Space>
                    <span style={{ fontWeight: 500 }}>API 端点</span>
                    {fields.length > 1 && (
                      <Tag color="blue">{fields.length} 个端点（{fields.length}x 并发）</Tag>
                    )}
                  </Space>
                </div>
                {fields.map((field) => (
                  <Form.Item key={field.key} style={{ marginBottom: 8 }}>
                    <Space align="baseline" style={{ width: '100%' }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'url']}
                        rules={[{ required: true, message: '请输入 API 地址' }]}
                        noStyle
                      >
                        <Input
                          placeholder="http://127.0.0.1:8000"
                          style={{ width: 380 }}
                        />
                      </Form.Item>
                      {fields.length > 1 && (
                        <MinusCircleOutlined
                          style={{ color: '#f38ba8', fontSize: 16, cursor: 'pointer' }}
                          onClick={() => remove(field.name)}
                        />
                      )}
                    </Space>
                  </Form.Item>
                ))}
                <Form.Item>
                  <Space style={{ width: '100%' }} direction="vertical">
                    <Button
                      type="dashed"
                      onClick={() => add({ url: '' })}
                      block
                      icon={<PlusOutlined />}
                      style={{ borderColor: '#585b70' }}
                    >
                      添加端点（多个端点可并发加速）
                    </Button>
                    <Button
                      type="dashed"
                      onClick={() => setImportModalOpen(true)}
                      block
                      icon={<ImportOutlined />}
                      style={{ borderColor: '#585b70' }}
                    >
                      一键导入 TTS 链接
                    </Button>
                  </Space>
                </Form.Item>
              </>
            )}
          </Form.List>
          <Form.Item name="api_key" label="API Key"><Input.Password placeholder="可选" /></Form.Item>
        </Form>
      </Modal>

      {/* 一键导入 TTS 链接 Modal */}
      <Modal
        title="📋 一键导入 TTS 链接"
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); setImportText(''); }}
        onOk={handleImportUrls}
        okText="导入"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12, color: '#a6adc8' }}>
          每行一个 URL，也支持逗号或分号分隔。导入后将替换当前表单中的端点列表。
        </div>
        <Input.TextArea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'http://192.168.1.100:8000\nhttp://192.168.1.101:8000\nhttp://192.168.1.102:8000'}
          style={{ fontFamily: 'monospace' }}
        />
        <div style={{ marginTop: 8, color: '#585b70', fontSize: 12 }}>
          提示：粘贴推理端的 URL 列表即可，会自动过滤无效行
        </div>
      </Modal>
    </div>
  );
}
