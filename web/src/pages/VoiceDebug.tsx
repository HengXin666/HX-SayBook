import { ClearOutlined, CompressOutlined, DeleteOutlined, ExpandOutlined, SoundOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Card, Collapse, Form, Input, List, Select, Slider, Space, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchApi } from '../api';
import { API_BASE } from '../api/client';
import AudioWaveform from '../components/AudioWaveform';
import { useAppStore } from '../store';

const { Title, Text } = Typography;
const { TextArea } = Input;

// 预置的调试文本模板
const SAMPLE_TEXTS = [
  { label: '😊 日常对白', text: '今天天气真好啊，我们一起去公园散步吧。' },
  { label: '😢 悲伤台词', text: '我知道一切都结束了，但是我真的很难接受这个现实。' },
  { label: '😠 愤怒台词', text: '你怎么能这样做！我真的无法原谅你！' },
  { label: '😱 惊恐台词', text: '那是什么？！快跑！不要回头看！' },
  { label: '🎭 旁白描述', text: '夕阳的余晖洒在古老的城墙上，远处传来悠扬的钟声，一切都显得那么宁静祥和。' },
  { label: '💬 长句测试', text: '在这个纷繁复杂的世界里，每个人都在寻找属于自己的方向，有的人选择了远方，有的人守护着故乡，但无论走到哪里，心中的那份温暖永远不会改变。' },
];

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

/** 批量对比组 */
interface CompareGroup {
  id: number;
  text: string;
  results: DebugResult[];
  timestamp: string;
}

// === localStorage 持久化 key ===
const LS_KEY_RESULTS = 'voice_debug_results';
const LS_KEY_COMPARE = 'voice_debug_compare';
const LS_MAX_RESULTS = 50;  // 最多保存 50 条单次调试记录
const LS_MAX_COMPARE = 20;  // 最多保存 20 组对比记录

/** 安全读取 localStorage JSON */
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 写入 localStorage */
function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage 满了则忽略
  }
}

/** 从 localStorage 恢复最大 id (用于 useRef 初始化) */
function initMaxId(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const arr = JSON.parse(raw) as Array<{ id: number; results?: Array<{ id: number }> }>;
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    // 对比组需要检查嵌套的 results 中的 id
    const ids = arr.flatMap(item => {
      const nested = item.results?.map(r => r.id) ?? [];
      return [item.id, ...nested];
    });
    return Math.max(...ids);
  } catch {
    return 0;
  }
}

export default function VoiceDebug() {
  const { voices, emotions, strengths, ttsProviders, fetchVoices, fetchEmotions, fetchStrengths, fetchTTSProviders } = useAppStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  // 从 localStorage 恢复历史记录
  const [results, setResults] = useState<DebugResult[]>(() => loadFromStorage(LS_KEY_RESULTS, []));
  const [previewSpeed, setPreviewSpeed] = useState(1.0);
  const resultIdRef = useRef<number>(initMaxId(LS_KEY_RESULTS));

  // 批量对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [compareGroups, setCompareGroups] = useState<CompareGroup[]>(() => loadFromStorage(LS_KEY_COMPARE, []));
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareForm] = Form.useForm();
  const compareGroupIdRef = useRef<number>(initMaxId(LS_KEY_COMPARE));

  useEffect(() => {
    fetchVoices();
    fetchEmotions();
    fetchStrengths();
    fetchTTSProviders();
  }, []);

  // 同步 results → localStorage
  useEffect(() => {
    saveToStorage(LS_KEY_RESULTS, results.slice(0, LS_MAX_RESULTS));
  }, [results]);

  // 同步 compareGroups → localStorage
  useEffect(() => {
    saveToStorage(LS_KEY_COMPARE, compareGroups.slice(0, LS_MAX_COMPARE));
  }, [compareGroups]);

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
        language: values.language || undefined,
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

        // 音频会通过波形组件自动展示
      } else {
        message.error(res.message || '生成失败');
      }
    } catch (err: any) {
      message.error(err?.message || '请求失败');
    } finally {
      setLoading(false);
    }
  };

  /** 批量对比生成：同一文本用不同参数组合同时生成 */
  const handleCompareGenerate = async () => {
    try {
      const values = await compareForm.validateFields();
      if (!values.voice_ids?.length) {
        message.warning('请至少选择一个音色');
        return;
      }
      setCompareLoading(true);

      const text = values.compare_text;
      const emotionName = values.compare_emotion || '平静';
      const strengthName = values.compare_strength || '中等';
      const speeds = values.compare_speeds || [1.0];

      const groupResults: DebugResult[] = [];

      for (const voiceId of values.voice_ids) {
        for (const spd of speeds) {
          try {
            const res = await batchApi.voiceDebug({
              text,
              voice_id: voiceId,
              tts_provider_id: values.compare_tts_provider_id,
              emotion_name: emotionName,
              strength_name: strengthName,
              speed: spd,
              language: values.compare_language || undefined,
            });

            if (res.code === 200 && res.data) {
              const voice = voices.find((v) => v.id === voiceId);
              groupResults.push({
                id: ++resultIdRef.current,
                text,
                voice_name: voice?.name || '未知',
                emotion: emotionName,
                strength: strengthName,
                speed: spd,
                audio_url: `${API_BASE}${res.data.audio_url}`,
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          } catch {
            // 单个失败不阻止整体
          }
        }
      }

      if (groupResults.length > 0) {
        const newGroup: CompareGroup = {
          id: ++compareGroupIdRef.current,
          text,
          results: groupResults,
          timestamp: new Date().toLocaleTimeString(),
        };
        setCompareGroups((prev) => [newGroup, ...prev]);
        message.success(`批量对比完成！共生成 ${groupResults.length} 条音频`);
      } else {
        message.error('所有音频生成均失败');
      }
    } catch (err: any) {
      message.error(err?.message || '请求失败');
    } finally {
      setCompareLoading(false);
    }
  };

  const handleDeleteResult = useCallback((id: number) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleDeleteCompareGroup = useCallback((id: number) => {
    setCompareGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  /** 清空单次调试历史 */
  const handleClearResults = useCallback(() => {
    setResults([]);
    localStorage.removeItem(LS_KEY_RESULTS);
  }, []);

  /** 清空对比历史 */
  const handleClearCompare = useCallback(() => {
    setCompareGroups([]);
    localStorage.removeItem(LS_KEY_COMPARE);
  }, []);

  const handleUseSampleText = (text: string) => {
    form.setFieldValue('text', text);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: '#cdd6f4', marginBottom: 4 }}>🔧 语音调试</Title>
          <Text type="secondary">
            独立的语音调试页面，可以快速测试不同音色、情绪、速度组合的效果
          </Text>
        </div>
        <Button
          icon={compareMode ? <CompressOutlined /> : <ExpandOutlined />}
          onClick={() => setCompareMode(!compareMode)}
          type={compareMode ? 'primary' : 'default'}
        >
          {compareMode ? '返回单次调试' : '批量对比模式'}
        </Button>
      </div>

      <Tabs
        activeKey={compareMode ? 'compare' : 'single'}
        onChange={(key) => setCompareMode(key === 'compare')}
        items={[
          {
            key: 'single',
            label: '🎛️ 单次调试',
            children: (
              <div style={{ display: 'flex', gap: 24 }}>
                {/* 左侧：调试面板 */}
                <Card style={{ flex: 1, background: '#1e1e2e', borderColor: '#313244' }} title="🎛️ 调试参数">
                  <Form form={form} layout="vertical" initialValues={{ emotion_name: '平静', strength_name: '中等', language: 'zh' }}>
                    <Form.Item name="text" label="文本内容" rules={[{ required: true, message: '请输入要合成的文本' }]}>
                      <TextArea rows={4} placeholder="输入想要转化为语音的文本..." maxLength={500} showCount />
                    </Form.Item>

                    {/* 快捷模板文本 */}
                    <div style={{ marginBottom: 16 }}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>快捷模板：</Text>
                      <Space size={[6, 6]} wrap>
                        {SAMPLE_TEXTS.map((s, idx) => (
                          <Tooltip key={idx} title={s.text}>
                            <Tag
                              style={{ cursor: 'pointer' }}
                              onClick={() => handleUseSampleText(s.text)}
                            >
                              {s.label}
                            </Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    </div>

                    <div style={{ display: 'flex', gap: 16 }}>
                      <Form.Item name="tts_provider_id" label="TTS 服务" rules={[{ required: true, message: '请选择 TTS 服务' }]} style={{ flex: 1 }}>
                        <Select placeholder="选择 TTS 服务">
                          {ttsProviders.map((p) => <Select.Option key={p.id} value={p.id}>{p.name} - {p.api_base_url}</Select.Option>)}
                        </Select>
                      </Form.Item>
                      <Form.Item name="language" label="语言" style={{ width: 120 }}>
                        <Select>
                          <Select.Option value="zh">🇨🇳 中文</Select.Option>
                          <Select.Option value="ja">🇯🇵 日语</Select.Option>
                        </Select>
                      </Form.Item>
                    </div>

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
                  title={`📜 调试历史 (${results.length})`}
                  extra={results.length > 0 ? <Button type="text" size="small" icon={<ClearOutlined />} onClick={handleClearResults}>清空</Button> : null}
                >
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
                          style={{ borderColor: '#313244', display: 'block', padding: '12px 0' }}
                        >
                          {/* 顶部：标签 + 删除按钮 */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <Space size={4}>
                              <Tag color="blue">{item.voice_name}</Tag>
                              <Tag color="green">{item.emotion}</Tag>
                              <Tag color="orange">{item.strength}</Tag>
                              <Tag>{item.speed}x</Tag>
                            </Space>
                            <Space size={4}>
                              <Text type="secondary" style={{ fontSize: 11 }}>{item.timestamp}</Text>
                              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteResult(item.id)} />
                            </Space>
                          </div>
                          {/* 文本内容 */}
                          <Text style={{ color: '#a6adc8', fontSize: 13, display: 'block', marginBottom: 6 }}>{item.text}</Text>
                          {/* 波形播放器 */}
                          <AudioWaveform url={item.audio_url} height={40} />
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: 'compare',
            label: '🔀 批量对比',
            children: (
              <div style={{ display: 'flex', gap: 24 }}>
                {/* 左侧：对比参数 */}
                <Card style={{ flex: 1, background: '#1e1e2e', borderColor: '#313244' }} title="🔀 批量对比参数">
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
                    选择同一段文本 + 多个音色/速度组合，一次性生成多条音频进行对比
                  </Text>
                  <Form form={compareForm} layout="vertical" initialValues={{ compare_emotion: '平静', compare_strength: '中等', compare_speeds: [1.0], compare_language: 'zh' }}>
                    <Form.Item name="compare_text" label="对比文本" rules={[{ required: true, message: '请输入文本' }]}>
                      <TextArea rows={3} placeholder="输入用于对比的文本..." maxLength={500} showCount />
                    </Form.Item>

                    {/* 快捷模板 */}
                    <div style={{ marginBottom: 16 }}>
                      <Space size={[6, 6]} wrap>
                        {SAMPLE_TEXTS.map((s, idx) => (
                          <Tooltip key={idx} title={s.text}>
                            <Tag style={{ cursor: 'pointer' }} onClick={() => compareForm.setFieldValue('compare_text', s.text)}>
                              {s.label}
                            </Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    </div>

                    <div style={{ display: 'flex', gap: 16 }}>
                      <Form.Item name="compare_tts_provider_id" label="TTS 服务" rules={[{ required: true, message: '请选择' }]} style={{ flex: 1 }}>
                        <Select placeholder="选择 TTS 服务">
                          {ttsProviders.map((p) => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
                        </Select>
                      </Form.Item>
                      <Form.Item name="compare_language" label="语言" style={{ width: 120 }}>
                        <Select>
                          <Select.Option value="zh">🇨🇳 中文</Select.Option>
                          <Select.Option value="ja">🇯🇵 日语</Select.Option>
                        </Select>
                      </Form.Item>
                    </div>

                    <Form.Item name="voice_ids" label="音色（可多选）" rules={[{ required: true, message: '请至少选择一个音色' }]}>
                      <Select mode="multiple" placeholder="选择要对比的音色" showSearch optionFilterProp="children" maxTagCount={5}>
                        {voices.map((v) => <Select.Option key={v.id} value={v.id}>{v.name}</Select.Option>)}
                      </Select>
                    </Form.Item>

                    <div style={{ display: 'flex', gap: 16 }}>
                      <Form.Item name="compare_emotion" label="情绪" style={{ flex: 1 }}>
                        <Select>
                          {emotions.map((e) => <Select.Option key={e.id} value={e.name}>{e.name}</Select.Option>)}
                        </Select>
                      </Form.Item>
                      <Form.Item name="compare_strength" label="强度" style={{ flex: 1 }}>
                        <Select>
                          {strengths.map((s) => <Select.Option key={s.id} value={s.name}>{s.name}</Select.Option>)}
                        </Select>
                      </Form.Item>
                    </div>

                    <Form.Item name="compare_speeds" label="语速组合（可多选）">
                      <Select mode="multiple" placeholder="选择要对比的语速">
                        {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((v) => (
                          <Select.Option key={v} value={v}>{v}x</Select.Option>
                        ))}
                      </Select>
                    </Form.Item>

                    <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleCompareGenerate} loading={compareLoading} block size="large">
                      {compareLoading ? '批量生成中...' : '开始批量对比'}
                    </Button>
                  </Form>
                </Card>

                {/* 右侧：对比结果 */}
                <Card style={{ flex: 1, background: '#1e1e2e', borderColor: '#313244', maxHeight: 700, overflow: 'auto' }}
                  title={`📊 对比结果 (${compareGroups.length} 组)`}
                  extra={compareGroups.length > 0 ? <Button type="text" size="small" icon={<ClearOutlined />} onClick={handleClearCompare}>清空</Button> : null}
                >
                  {compareGroups.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#6c7086' }}>
                      <SoundOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                      <div>暂无对比记录</div>
                      <div style={{ fontSize: 12, marginTop: 8 }}>选择多个音色/速度进行批量对比</div>
                    </div>
                  ) : (
                    <Collapse
                      items={compareGroups.map((group) => ({
                        key: group.id,
                        label: (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <Space>
                              <Tag color="blue">{group.results.length} 条对比</Tag>
                              <Text style={{ color: '#a6adc8', fontSize: 12 }} ellipsis>{group.text.slice(0, 30)}...</Text>
                            </Space>
                            <Space>
                              <Text type="secondary" style={{ fontSize: 11 }}>{group.timestamp}</Text>
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(e) => { e.stopPropagation(); handleDeleteCompareGroup(group.id); }}
                              />
                            </Space>
                          </div>
                        ),
                        children: (
                          <List
                            size="small"
                            dataSource={group.results}
                            renderItem={(item) => (
                              <List.Item
                                style={{ borderColor: '#313244', display: 'block', padding: '8px 0' }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                                  <Space size={4}>
                                    <Tag color="blue">{item.voice_name}</Tag>
                                    <Tag color="green">{item.emotion}</Tag>
                                    <Tag>{item.speed}x</Tag>
                                  </Space>
                                </div>
                                <AudioWaveform url={item.audio_url} height={36} mini />
                              </List.Item>
                            )}
                          />
                        ),
                      }))}
                    />
                  )}
                </Card>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
