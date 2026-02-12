import {
    DeleteOutlined,
    DownloadOutlined,
    PlusOutlined,
    ReloadOutlined, RobotOutlined,
    RocketOutlined, SoundOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import {
    Button,
    Card,
    Checkbox,
    Form,
    Input,
    Layout,
    message,
    Modal,
    Popconfirm,
    Progress,
    Slider,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { batchApi, chapterApi, lineApi, projectApi } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAppStore } from '../store';
import type { Chapter, Line, WSEvent } from '../types';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const {
    currentProject, setCurrentProject, chapters, fetchChapters, currentChapter, setCurrentChapter,
    lines, fetchLines, roles, fetchRoles, emotions, fetchEmotions, strengths, fetchStrengths,
    voices, fetchVoices, logs, addLog, clearLogs,
  } = useAppStore();

  const { subscribe } = useWebSocket();
  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [chapterForm] = Form.useForm();
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([]);
  const [batchSpeed, setBatchSpeed] = useState(1.0);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchStatus, setBatchStatus] = useState<string>('');
  const [ttsProgress, setTtsProgress] = useState(0);
  const [ttsStatus, setTtsStatus] = useState<string>('');
  const logEndRef = useRef<HTMLDivElement>(null);

  // 加载数据
  useEffect(() => {
    if (projectId) {
      projectApi.get(projectId).then((res) => { if (res.data) setCurrentProject(res.data); });
      fetchChapters(projectId);
      fetchRoles(projectId);
      fetchEmotions();
      fetchStrengths();
    }
  }, [projectId]);

  useEffect(() => {
    if (currentProject?.tts_provider_id) {
      fetchVoices(currentProject.tts_provider_id);
    }
  }, [currentProject?.tts_provider_id]);

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // WebSocket 事件订阅
  useEffect(() => {
    const unsubs = [
      subscribe('batch_llm_progress', (data: WSEvent) => {
        addLog(data.log as string);
        setBatchProgress(data.progress as number);
        setBatchStatus(data.status as string);
        if (data.status === 'done' && data.chapter_id) {
          fetchChapters(projectId);
        }
      }),
      subscribe('batch_llm_log', (data: WSEvent) => {
        addLog(data.log as string);
      }),
      subscribe('batch_llm_complete', (data: WSEvent) => {
        addLog(data.log as string);
        setBatchProgress(100);
        setBatchStatus('complete');
        message.success('批量LLM解析完成！');
        fetchChapters(projectId);
      }),
      subscribe('batch_tts_start', (data: WSEvent) => {
        addLog(data.log as string);
        setTtsProgress(0);
      }),
      subscribe('batch_tts_line_progress', (data: WSEvent) => {
        addLog(data.log as string);
        setTtsProgress(data.progress as number);
        setTtsStatus(data.status as string);
        if (data.status === 'done' && data.line_id) {
          useAppStore.getState().updateLineStatus(data.line_id as number, 'done', data.audio_path as string);
        }
      }),
      subscribe('batch_tts_chapter_start', (data: WSEvent) => {
        addLog(data.log as string);
      }),
      subscribe('batch_tts_chapter_done', (data: WSEvent) => {
        addLog(data.log as string);
      }),
      subscribe('batch_tts_complete', (data: WSEvent) => {
        addLog(data.log as string);
        setTtsProgress(100);
        setTtsStatus('complete');
        message.success('批量配音完成！');
        if (currentChapter) fetchLines(currentChapter.id);
      }),
      subscribe('batch_tts_log', (data: WSEvent) => {
        addLog(data.log as string);
      }),
      subscribe('line_update', (data: WSEvent) => {
        useAppStore.getState().updateLineStatus(data.line_id as number, data.status as Line['status'], data.audio_path as string);
        if (data.log) addLog(data.meta as string || '');
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, projectId, currentChapter]);

  // 选中章节
  const handleSelectChapter = (chapter: Chapter) => {
    setCurrentChapter(chapter);
    fetchLines(chapter.id);
  };

  // 创建章节
  const handleCreateChapter = async () => {
    try {
      const values = await chapterForm.validateFields();
      await chapterApi.create({ ...values, project_id: projectId });
      message.success('章节创建成功');
      setChapterModalOpen(false);
      chapterForm.resetFields();
      fetchChapters(projectId);
    } catch {
      message.error('创建失败');
    }
  };

  // 删除章节
  const handleDeleteChapter = async (chapterId: number) => {
    await chapterApi.delete(chapterId);
    message.success('已删除');
    if (currentChapter?.id === chapterId) {
      setCurrentChapter(null);
    }
    fetchChapters(projectId);
  };

  // 单章节LLM解析
  const handleParseSingle = async (chapterId: number) => {
    clearLogs();
    setBatchProgress(0);
    addLog('🚀 启动 LLM 解析...');
    await batchApi.llmParse({ project_id: projectId, chapter_ids: [chapterId] });
  };

  // 批量LLM解析
  const handleBatchLLM = async () => {
    if (selectedChapterIds.length === 0) {
      message.warning('请先选择章节');
      return;
    }
    clearLogs();
    setBatchProgress(0);
    addLog(`🚀 启动批量 LLM 解析，共 ${selectedChapterIds.length} 章...`);
    await batchApi.llmParse({ project_id: projectId, chapter_ids: selectedChapterIds });
  };

  // 批量TTS配音
  const handleBatchTTS = async () => {
    if (selectedChapterIds.length === 0) {
      message.warning('请先选择章节');
      return;
    }
    clearLogs();
    setTtsProgress(0);
    addLog(`🎙️ 启动批量配音，共 ${selectedChapterIds.length} 章，速度 ${batchSpeed}x...`);
    await batchApi.ttsGenerate({ project_id: projectId, chapter_ids: selectedChapterIds, speed: batchSpeed });
  };

  // 单章节TTS配音
  const handleTTSSingle = async (chapterId: number) => {
    clearLogs();
    setTtsProgress(0);
    addLog('🎙️ 启动章节配音...');
    await batchApi.ttsGenerate({ project_id: projectId, chapter_ids: [chapterId], speed: batchSpeed });
  };

  // 导出音频
  const handleExport = async (chapterId: number) => {
    const res = await lineApi.exportAudio(chapterId, true);
    if (res.code === 200) message.success('导出成功');
    else message.error(res.message);
  };

  // 角色名映射
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const emotionMap = Object.fromEntries(emotions.map((e) => [e.id, e.name]));
  const strengthMap = Object.fromEntries(strengths.map((s) => [s.id, s.name]));

  // 台词表格列
  const lineColumns = [
    {
      title: '序号',
      dataIndex: 'line_order',
      key: 'line_order',
      width: 60,
    },
    {
      title: '角色',
      dataIndex: 'role_id',
      key: 'role_id',
      width: 100,
      render: (roleId: number) => (
        <Tag color={roleId ? 'blue' : 'default'}>{roleMap[roleId] || '未知'}</Tag>
      ),
    },
    {
      title: '台词',
      dataIndex: 'text_content',
      key: 'text_content',
      ellipsis: true,
    },
    {
      title: '情绪',
      key: 'emotion',
      width: 80,
      render: (_: unknown, record: Line) => emotionMap[record.emotion_id!] || '-',
    },
    {
      title: '强度',
      key: 'strength',
      width: 80,
      render: (_: unknown, record: Line) => strengthMap[record.strength_id!] || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          pending: 'default', processing: 'processing', done: 'success', failed: 'error',
        };
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>;
      },
    },
    {
      title: '试听',
      key: 'audio',
      width: 60,
      render: (_: unknown, record: Line) =>
        record.audio_path && record.status === 'done' ? (
          <SoundOutlined style={{ cursor: 'pointer', color: '#a6e3a1' }} />
        ) : null,
    },
  ];

  return (
    <Layout style={{ background: 'transparent', height: '100%' }}>
      {/* 左侧章节列表 */}
      <Sider width={280} style={{ background: '#1e1e2e', borderRight: '1px solid #313244', borderRadius: 8, marginRight: 16 }}>
        <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={5} style={{ margin: 0, color: '#cdd6f4' }}>📑 章节列表</Title>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setChapterModalOpen(true)} />
        </div>

        <div style={{ padding: '0 8px' }}>
          {chapters.map((ch) => (
            <Card
              key={ch.id}
              size="small"
              hoverable
              style={{
                marginBottom: 8,
                background: currentChapter?.id === ch.id ? '#313244' : '#181825',
                borderColor: currentChapter?.id === ch.id ? '#6366f1' : '#313244',
                cursor: 'pointer',
              }}
              onClick={() => handleSelectChapter(ch)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Checkbox
                  checked={selectedChapterIds.includes(ch.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSelectedChapterIds((prev) =>
                      e.target.checked ? [...prev, ch.id] : prev.filter((id) => id !== ch.id),
                    );
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <Text style={{ flex: 1, marginLeft: 8, color: '#cdd6f4' }} ellipsis>{ch.title}</Text>
                <Space size={4}>
                  <Tooltip title="LLM解析">
                    <RobotOutlined style={{ fontSize: 12, color: '#89b4fa' }} onClick={(e) => { e.stopPropagation(); handleParseSingle(ch.id); }} />
                  </Tooltip>
                  <Tooltip title="一键配音">
                    <SoundOutlined style={{ fontSize: 12, color: '#a6e3a1' }} onClick={(e) => { e.stopPropagation(); handleTTSSingle(ch.id); }} />
                  </Tooltip>
                  <Tooltip title="导出">
                    <DownloadOutlined style={{ fontSize: 12, color: '#f9e2af' }} onClick={(e) => { e.stopPropagation(); handleExport(ch.id); }} />
                  </Tooltip>
                  <Popconfirm title="确定删除？" onConfirm={() => handleDeleteChapter(ch.id)}>
                    <DeleteOutlined style={{ fontSize: 12, color: '#f38ba8' }} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </Space>
              </div>
            </Card>
          ))}
        </div>

        {/* 批量操作区 */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #313244' }}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Button block icon={<Checkbox onChange={(e) => {
              setSelectedChapterIds(e.target.checked ? chapters.map((c) => c.id) : []);
            }} />}>
              <span style={{ marginLeft: 4 }}>全选 ({selectedChapterIds.length}/{chapters.length})</span>
            </Button>
            <div>
              <Text style={{ fontSize: 12, color: '#a6adc8' }}>配音速度: {batchSpeed}x</Text>
              <Slider
                min={0.5} max={2.0} step={0.1} value={batchSpeed}
                onChange={setBatchSpeed}
                style={{ margin: '4px 0' }}
              />
            </div>
            <Button type="primary" block icon={<RocketOutlined />} onClick={handleBatchLLM}
              disabled={selectedChapterIds.length === 0}>
              批量LLM解析
            </Button>
            <Button block icon={<ThunderboltOutlined />} onClick={handleBatchTTS}
              disabled={selectedChapterIds.length === 0}
              style={{ background: '#a6e3a1', color: '#1e1e2e', borderColor: '#a6e3a1' }}>
              批量配音
            </Button>
          </Space>
        </div>
      </Sider>

      {/* 右侧内容区 */}
      <Content style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 进度条 */}
        {(batchProgress > 0 || ttsProgress > 0) && (
          <Card size="small" style={{ background: '#1e1e2e', borderColor: '#313244' }}>
            {batchProgress > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Text style={{ color: '#89b4fa' }}>LLM 解析进度</Text>
                <Progress percent={batchProgress} status={batchStatus === 'error' ? 'exception' : batchProgress >= 100 ? 'success' : 'active'} />
              </div>
            )}
            {ttsProgress > 0 && (
              <div>
                <Text style={{ color: '#a6e3a1' }}>TTS 配音进度</Text>
                <Progress percent={ttsProgress} status={ttsStatus === 'error' ? 'exception' : ttsProgress >= 100 ? 'success' : 'active'} />
              </div>
            )}
          </Card>
        )}

        {/* 台词表格 */}
        <Card
          title={currentChapter ? `📝 ${currentChapter.title} - 台词列表` : '📝 请选择章节'}
          size="small"
          style={{ background: '#1e1e2e', borderColor: '#313244', flex: 1 }}
          extra={currentChapter && (
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchLines(currentChapter.id)}>刷新</Button>
            </Space>
          )}
        >
          {currentChapter ? (
            <Table
              dataSource={lines}
              columns={lineColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
              scroll={{ y: 400 }}
              style={{ background: 'transparent' }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#6c7086' }}>
              请从左侧选择一个章节查看台词
            </div>
          )}
        </Card>

        {/* 日志面板 */}
        <Card title="📋 操作日志" size="small" style={{ background: '#1e1e2e', borderColor: '#313244' }}
          extra={<Button size="small" onClick={clearLogs}>清空</Button>}>
          <div className="log-panel">
            {logs.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>暂无日志</Text>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`log-line ${log.includes('❌') ? 'error' : log.includes('✅') || log.includes('🎉') ? 'success' : log.includes('⚠️') ? 'warning' : ''}`}>
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </Card>
      </Content>

      {/* 创建章节 Modal */}
      <Modal title="创建章节" open={chapterModalOpen} onOk={handleCreateChapter} onCancel={() => setChapterModalOpen(false)}>
        <Form form={chapterForm} layout="vertical">
          <Form.Item name="title" label="章节标题" rules={[{ required: true }]}>
            <Input placeholder="输入章节标题" />
          </Form.Item>
          <Form.Item name="text_content" label="章节内容">
            <Input.TextArea rows={10} placeholder="粘贴小说章节内容" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
