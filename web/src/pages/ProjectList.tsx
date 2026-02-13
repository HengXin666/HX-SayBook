import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, message, Modal, Popconfirm, Row, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectApi } from '../api';
import { useAppStore } from '../store';
import type { Project } from '../types';

const { Title, Text } = Typography;

export default function ProjectList() {
  const navigate = useNavigate();
  const { projects, fetchProjects, llmProviders, ttsProviders, prompts, voices, fetchLLMProviders, fetchTTSProviders, fetchPrompts, fetchVoices } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchProjects();
    fetchLLMProviders();
    fetchTTSProviders();
    fetchPrompts();
    fetchVoices();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      if (editProject) {
        await projectApi.update(editProject.id, values);
        message.success('项目更新成功');
      } else {
        await projectApi.create(values);
        message.success('项目创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditProject(null);
      fetchProjects();
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    await projectApi.delete(id);
    message.success('已删除');
    fetchProjects();
  };

  const openEdit = (project: Project) => {
    setEditProject(project);
    form.setFieldsValue(project);
    setModalOpen(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, color: '#cdd6f4' }}>📚 项目管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditProject(null); form.resetFields(); setModalOpen(true); }}>
          创建项目
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {projects.map((p) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={p.id}>
            <Card
              hoverable
              style={{ background: '#1e1e2e', borderColor: '#313244' }}
              actions={[
                <PlayCircleOutlined key="open" onClick={() => navigate(`/projects/${p.id}/dubbing`)} />,
                <EditOutlined key="edit" onClick={() => openEdit(p)} />,
                <Popconfirm title="确定删除此项目？" onConfirm={() => handleDelete(p.id)}>
                  <DeleteOutlined key="delete" />
                </Popconfirm>,
              ]}
            >
              <Card.Meta
                title={<Text style={{ color: '#cdd6f4', fontSize: 16 }}>{p.name}</Text>}
                description={
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">{p.description || '暂无描述'}</Text>
                    <div>
                      {p.llm_provider_id && <Tag color="blue">LLM</Tag>}
                      {p.tts_provider_id && <Tag color="green">TTS</Tag>}
                      {p.prompt_id && <Tag color="purple">提示词</Tag>}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(p.created_at).toLocaleDateString()}
                    </Text>
                  </Space>
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

      {projects.length === 0 && (
        <div style={{ textAlign: 'center', padding: 80, color: '#6c7086' }}>
          <Title level={4} style={{ color: '#6c7086' }}>暂无项目</Title>
          <Text type="secondary">点击"创建项目"开始使用</Text>
        </div>
      )}

      <Modal
        title={editProject ? '编辑项目' : '创建项目'}
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => { setModalOpen(false); setEditProject(null); }}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="输入项目名称" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={2} placeholder="项目描述（可选）" />
          </Form.Item>
          <Form.Item name="llm_provider_id" label="LLM 提供商">
            <Select
              allowClear
              placeholder="选择 LLM 提供商"
              options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(val) => {
                // 联动：切换 LLM 提供商时清空模型选择
                form.setFieldValue('llm_model', null);
                form.setFieldValue('llm_provider_id', val);
              }}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.llm_provider_id !== cur.llm_provider_id}>
            {() => {
              const selectedProviderId = form.getFieldValue('llm_provider_id');
              const provider = llmProviders.find((p) => p.id === selectedProviderId);
              const models = provider?.model_list ? String(provider.model_list).split(',').map((m) => m.trim()).filter(Boolean) : [];
              return (
                <Form.Item name="llm_model" label="LLM 模型">
                  <Select
                    allowClear
                    placeholder={models.length > 0 ? '请选择模型' : '请先配置 LLM 提供商的模型列表'}
                    options={models.map((m) => ({ value: m, label: m }))}
                    disabled={models.length === 0}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="tts_provider_id" label="TTS 引擎">
            <Select allowClear placeholder="选择 TTS 提供商" options={ttsProviders.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="prompt_id" label="提示词模板">
            <Select allowClear placeholder="选择提示词" options={prompts.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="is_precise_fill" label="精准填充">
            <Select options={[{ value: 0, label: '关闭' }, { value: 1, label: '开启' }]} />
          </Form.Item>
          <Form.Item name="passerby_voice_pool" label="路人语音池" tooltip="选择用于路人角色随机分配的音色，未绑定音色的角色将从此池中随机获取">
            <Select
              mode="multiple"
              allowClear
              placeholder="选择音色加入路人语音池"
              options={voices.map((v) => ({ value: v.id, label: v.name }))}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
