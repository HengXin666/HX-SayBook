import { DeleteOutlined, PlayCircleOutlined, SoundOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, List, Select, Slider, Space, Tag, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { batchApi } from '../api';
import { API_BASE } from '../api/client';
import { useAppStore } from '../store';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface DebugResult {
  id: number;
  text: string;
  voice_name: string;
  emotion: string;
  strength: string;
  speed: number;
  audio_url: string;
  timestamp: string;
}

export default function VoiceDebug() {
  const { voices, emotions, strengths, ttsProviders, fetchVoices, fetchEmotions, fetchStrengths, fetchTTSProviders } = useAppStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DebugResult[]>([]);
  const [previewSpeed, setPreviewSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resultIdRef = useRef(0);

  useEffect(() => {
    fetchVoices();
    fetchEmotions();
    fetchStrengths();
    fetchTTSProviders();
  }, []);

  const handleGenerate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const res = await batchApi.voiceDebug({
        text: values.text,
        voice_id: values.voice_id,
        tts_provider_id: values.tts_provider_id,
        emotion_name: values.emotion_name || '平静',
        strength_name: values.strength_name || '中等',
        speed: previewSpeed,
      });

      if (res.code === 200 && res.data) {
        const voice = voices.find((v) => v.id === values.voice_id);
        const newResult: DebugResult = {
          id: ++resultIdRef.current,
          text: values.text,
          voice_name: voice?.name || '未知',
          emotion: values.emotion_name || '平静',
          strength: values.strength_name || '中等',
          speed: previewSpeed,
          audio_url: `${API_BASE}${res.data.audio_url}`,
          timestamp: new Date().toLocaleTimeString(),
        };
        setResults((prev) => [newResult, ...prev]);
        message.success('语音生成成功！');

        // 自动播放
        if (audioRef.current) {
          audioRef.current.src = newResult.audio_url;
          audioRef.current.play().catch(() => {});
        }
      } else {
        message.error(res.message || '生成失败');
      }
    } catch (err: any) {
      message.error(err?.message || '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (url: string) => {
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    }
  };

  const handleDeleteResult = (id: number) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div>
      <Title level={3} style={{ color: '#cdd6f4', marginBottom: 24 }}>🔧 语音调试</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        独立的语音调试页面，可以快速测试不同音色、情绪、速度组合的效果
      </Text>

      {/* 隐藏的 audio 播放器 */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      <div style={{ display: 'flex', gap: 24 }}>
        {/* 左侧：调试面板 */}
        <Card style={{ flex: 1, background: '#1e1e2e', borderColor: '#313244' }} title="🎛️ 调试参数">
          <Form form={form} layout="vertical" initialValues={{ emotion_name: '平静', strength_name: '中等' }}>
            <Form.Item name="text" label="文本内容" rules={[{ required: true, message: '请输入要合成的文本' }]}>
              <TextArea rows={4} placeholder="输入想要转化为语音的文本..." maxLength={500} showCount />
            </Form.Item>

            <Form.Item name="tts_provider_id" label="TTS 服务" rules={[{ required: true, message: '请选择 TTS 服务' }]}>
              <Select placeholder="选择 TTS 服务">
                {ttsProviders.map((p) => <Select.Option key={p.id} value={p.id}>{p.name} - {p.api_base_url}</Select.Option>)}
              </Select>
            </Form.Item>

            <Form.Item name="voice_id" label="音色" rules={[{ required: true, message: '请选择音色' }]}>
              <Select placeholder="选择音色" showSearch optionFilterProp="children">
                {voices.map((v) => <Select.Option key={v.id} value={v.id}>{v.name}{v.description ? ` - ${v.description}` : ''}</Select.Option>)}
              </Select>
            </Form.Item>

            <div style={{ display: 'flex', gap: 16 }}>
              <Form.Item name="emotion_name" label="情绪" style={{ flex: 1 }}>
                <Select>
                  {emotions.map((e) => <Select.Option key={e.id} value={e.name}>{e.name}</Select.Option>)}
                </Select>
              </Form.Item>
              <Form.Item name="strength_name" label="强度" style={{ flex: 1 }}>
                <Select>
                  {strengths.map((s) => <Select.Option key={s.id} value={s.name}>{s.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </div>

            <Form.Item label={`语速: ${previewSpeed}x`}>
              <Slider min={0.5} max={2.0} step={0.1} value={previewSpeed} onChange={setPreviewSpeed}
                marks={{ 0.5: '0.5x', 1.0: '1.0x', 1.5: '1.5x', 2.0: '2.0x' }} />
            </Form.Item>

            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerate} loading={loading} block size="large">
              {loading ? '生成中...' : '生成语音'}
            </Button>
          </Form>
        </Card>

        {/* 右侧：历史结果 */}
        <Card style={{ flex: 1, background: '#1e1e2e', borderColor: '#313244', maxHeight: 700, overflow: 'auto' }}
          title={`📜 调试历史 (${results.length})`}>
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6c7086' }}>
              <SoundOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <div>暂无调试记录</div>
              <div style={{ fontSize: 12, marginTop: 8 }}>点击"生成语音"开始调试</div>
            </div>
          ) : (
            <List
              dataSource={results}
              renderItem={(item) => (
                <List.Item
                  style={{ borderColor: '#313244' }}
                  actions={[
                    <Button key="play" type="link" icon={<PlayCircleOutlined />} onClick={() => handlePlay(item.audio_url)}>播放</Button>,
                    <Button key="delete" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDeleteResult(item.id)} />,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag color="blue">{item.voice_name}</Tag>
                        <Tag color="green">{item.emotion}</Tag>
                        <Tag color="orange">{item.strength}</Tag>
                        <Tag>{item.speed}x</Tag>
                      </Space>
                    }
                    description={
                      <div>
                        <Text style={{ color: '#a6adc8', fontSize: 13 }}>{item.text}</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{item.timestamp}</Text>
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
