import { DashboardOutlined } from '@ant-design/icons';
import { Button, Modal, Slider, Space, Typography, message } from 'antd';
import { useState } from 'react';
import { batchApi } from '../api';

const { Text } = Typography;

interface SpeedControlProps {
  /** 单条台词速度调节 */
  lineId?: number;
  /** 批量（章节级别）速度调节 */
  chapterId?: number;
  /** 当前速度值（仅展示用） */
  currentSpeed?: number;
  /** 完成回调 */
  onComplete?: () => void;
  /** 按钮尺寸 */
  size?: 'small' | 'middle' | 'large';
  /** 按钮类型 */
  type?: 'line' | 'chapter';
}

export default function SpeedControl({ lineId, chapterId, currentSpeed = 1.0, onComplete, size = 'small', type = 'line' }: SpeedControlProps) {
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState(currentSpeed);
  const [loading, setLoading] = useState(false);

  const handleOpen = () => {
    setSpeed(currentSpeed);
    setOpen(true);
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      if (type === 'line' && lineId) {
        const res = await batchApi.adjustSpeed(lineId, speed);
        if (res.code === 200) {
          message.success(`语速已调整为 ${speed}x`);
          onComplete?.();
          setOpen(false);
        } else {
          message.error(res.message || '调节失败');
        }
      } else if (type === 'chapter' && chapterId) {
        const res = await batchApi.batchAdjustSpeed(chapterId, speed);
        if (res.code === 200) {
          message.success(`章节语速已批量调整为 ${speed}x`);
          onComplete?.();
          setOpen(false);
        } else {
          message.error(res.message || '批量调节失败');
        }
      }
    } catch {
      message.error('请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        icon={<DashboardOutlined />}
        onClick={handleOpen}
        title={type === 'chapter' ? '批量调节语速' : '调节语速'}
      >
        {type === 'chapter' ? '全局语速' : `${currentSpeed}x`}
      </Button>

      <Modal
        title={
          <Space>
            <DashboardOutlined />
            <span>{type === 'chapter' ? '全局语速调节' : '单条语速调节'}</span>
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        width={480}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={loading} onClick={handleApply}>
              应用 ({speed}x)
            </Button>
          </Space>
        }
        destroyOnClose
      >
        <div style={{ padding: '16px 0' }}>
          <Text style={{ color: '#cdd6f4', display: 'block', marginBottom: 8 }}>
            {type === 'chapter'
              ? '调整本章节所有已生成音频的语速（会直接修改音频文件）'
              : '调整这条台词的语速（会直接修改音频文件）'}
          </Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
            范围: 0.5x (慢速) ~ 2.0x (快速)，1.0x 为原速
          </Text>

          <div style={{ padding: '0 16px' }}>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <span style={{
                fontSize: 32,
                fontWeight: 700,
                color: speed === 1.0 ? '#a6e3a1' : speed > 1.0 ? '#89b4fa' : '#f9e2af',
              }}>
                {speed}x
              </span>
            </div>
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={speed}
              onChange={setSpeed}
              marks={{
                0.5: '0.5x',
                0.75: '0.75x',
                1.0: '1.0x',
                1.25: '1.25x',
                1.5: '1.5x',
                2.0: '2.0x',
              }}
            />
          </div>

          {/* 快捷按钮 */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((v) => (
              <Button
                key={v}
                size="small"
                type={speed === v ? 'primary' : 'default'}
                onClick={() => setSpeed(v)}
                style={{ minWidth: 50 }}
              >
                {v}x
              </Button>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
