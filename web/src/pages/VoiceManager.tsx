import { DeleteOutlined, EditOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, SoundOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { Button, Card, Form, Input, message, Modal, Popconfirm, Space, Table, Tag, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { voiceApi } from '../api';
import { useAppStore } from '../store';
import type { Voice } from '../types';

const { Title, Text } = Typography;

export default function VoiceManager() {
  const { voices, fetchVoices, fetchTTSProviders } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editVoice, setEditVoice] = useState<Voice | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  // 当前正在播放的音色ID
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchVoices();
    fetchTTSProviders();
  }, []);

  // 清理音频
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const openCreateModal = () => {
    setEditVoice(null);
    form.resetFields();
    setFileList([]);
    setModalOpen(true);
  };

  const openEditModal = (voice: Voice) => {
    setEditVoice(voice);
    form.setFieldsValue({ name: voice.name, description: voice.description });
    setFileList([]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setUploading(true);

      if (editVoice && fileList.length === 0) {
        // 编辑模式且没有上传新文件 → 直接更新文本字段
        await voiceApi.update(editVoice.id, {
          name: values.name,
          description: values.description,
          tts_provider_id: editVoice.tts_provider_id,
        });
        message.success('音色更新成功');
      } else {
        // 有新文件上传，使用 upload 接口
        const formData = new FormData();
        formData.append('name', values.name);
        formData.append('tts_provider_id', '1');
        if (values.description) formData.append('description', values.description);
        if (editVoice) formData.append('voice_id', String(editVoice.id));
        if (fileList.length > 0 && fileList[0].originFileObj) {
          formData.append('file', fileList[0].originFileObj);
        }
        const res = await voiceApi.upload(formData);
        if (res.code === 200) {
          message.success(editVoice ? '音色更新成功' : '音色创建成功');
        } else {
          message.error(res.message || '操作失败');
          setUploading(false);
          return;
        }
      }

      setModalOpen(false);
      form.resetFields();
      setEditVoice(null);
      setFileList([]);
      fetchVoices();
    } catch {
      message.error('操作失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    await voiceApi.delete(id);
    message.success('已删除');
    fetchVoices();
  };

  const handlePlay = (voice: Voice) => {
    if (!voice.reference_path) {
      message.warning('该音色没有参考音频');
      return;
    }

    // 如果正在播放同一个，暂停
    if (playingId === voice.id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }

    // 停止之前播放的
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const url = voiceApi.getAudioUrl(voice.reference_path);
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(voice.id);

    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };

    audio.onerror = () => {
      // 仅在尚未开始播放时提示错误（避免 abort 等非真实错误重复提示）
      if (audioRef.current === audio) {
        message.error('播放失败，音频文件可能不存在');
        setPlayingId(null);
        audioRef.current = null;
      }
    };

    audio.play().catch((err) => {
      // AbortError 是用户快速切换/暂停导致的，不算真正的播放失败
      if (err.name === 'AbortError') return;
      // 如果 onerror 已经处理过了就不重复提示
      if (audioRef.current !== audio) return;
      message.error('播放失败，音频文件可能不存在');
      setPlayingId(null);
      audioRef.current = null;
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '多情绪', dataIndex: 'is_multi_emotion', key: 'is_multi_emotion', width: 80,
      render: (v: number | null | undefined) => {
        if (v === 1) return <Tag color="green">是</Tag>;
        return <Tag color="default">否</Tag>;
      },
    },
    {
      title: '参考音频', dataIndex: 'reference_path', key: 'reference_path', width: 200, ellipsis: true,
      render: (v: string) => v
        ? <Text type="secondary" style={{ fontSize: 12 }}>{v.split('/').pop()}</Text>
        : <Text type="warning" style={{ fontSize: 12 }}>未上传</Text>,
    },
    {
      title: '操作', key: 'action', width: 180,
      render: (_: unknown, record: Voice) => (
        <Space>
          <Button
            size="small"
            type={playingId === record.id ? 'primary' : 'default'}
            icon={playingId === record.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => handlePlay(record)}
            disabled={!record.reference_path}
            title="试听"
          />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} title="编辑" />
          <Popconfirm title="确定删除此音色？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} title="删除" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, color: '#cdd6f4' }}>🎵 音色管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增音色
        </Button>
      </div>

      <Card style={{ background: '#1e1e2e', borderColor: '#313244' }}>
        <Table dataSource={voices} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 20 }} />
      </Card>

      <Modal
        title={editVoice ? '编辑音色' : '新增音色'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditVoice(null); form.resetFields(); setFileList([]); }}
        confirmLoading={uploading}
        okText={uploading ? '上传中...' : '确定'}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入音色名称' }]}>
            <Input placeholder="例如：温柔女声、沧桑大叔" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="音色描述（可选）" />
          </Form.Item>

          {/* 当前参考音频 */}
          {editVoice?.reference_path && (
            <Form.Item label="当前参考音频">
              <Space>
                <SoundOutlined />
                <Text type="secondary" style={{ fontSize: 12 }}>{editVoice.reference_path.split('/').pop()}</Text>
                <Button
                  size="small"
                  type="link"
                  icon={playingId === editVoice.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  onClick={() => handlePlay(editVoice)}
                >
                  {playingId === editVoice.id ? '暂停' : '试听'}
                </Button>
              </Space>
            </Form.Item>
          )}

          <Form.Item label={editVoice?.reference_path ? '替换参考音频（可选）' : '上传参考音频'}>
            <Upload
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: newFileList }) => setFileList(newFileList.slice(-1))}
              accept=".wav,.mp3,.flac,.ogg,.m4a"
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>选择音频文件</Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 12 }}>支持 wav、mp3、flac、ogg、m4a 格式</Text>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
