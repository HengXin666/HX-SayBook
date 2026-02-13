import {
  AudioOutlined,
  BugOutlined,
  FileTextOutlined,
  GithubOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  SettingOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Tooltip } from 'antd';
import { useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import ConfigCenter from './pages/ConfigCenter';
import ProjectDetail from './pages/ProjectDetail';
import ProjectList from './pages/ProjectList';
import PromptManager from './pages/PromptManager';
import VoiceDebug from './pages/VoiceDebug';
import VoiceManager from './pages/VoiceManager';

const { Sider, Content } = Layout;

const menuItems = [
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/config', icon: <SettingOutlined />, label: '配置中心' },
  { key: '/voices', icon: <SoundOutlined />, label: '音色管理' },
  { key: '/prompts', icon: <FileTextOutlined />, label: '提示词管理' },
  { key: '/voice-debug', icon: <BugOutlined />, label: '语音调试' },
];

const APP_VERSION = 'v2.3.0';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // 获取当前选中的菜单key
  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '/projects';

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider
        width={220}
        collapsedWidth={64}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        style={{ borderRight: '1px solid #313244', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Logo 区域 */}
          <div className="logo-title" style={{ justifyContent: collapsed ? 'center' : 'center' }}>
            <AudioOutlined style={{ fontSize: collapsed ? 28 : 24 }} />
            {!collapsed && <span>HX-SayBook</span>}
          </div>

          {/* 菜单 */}
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderRight: 'none', flex: 1 }}
            inlineCollapsed={collapsed}
          />

          {/* 底部区域：版本信息 + 收起按钮 */}
          <div style={{
            borderTop: '1px solid #313244',
            padding: collapsed ? '12px 8px' : '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {/* 版本信息和项目介绍 */}
            {!collapsed ? (
              <div style={{ fontSize: 12, color: '#6c7086', lineHeight: 1.8 }}>
                <div style={{ color: '#a6adc8', fontWeight: 500, marginBottom: 4 }}>
                  📚 HX-SayBook <span style={{ color: '#6366f1' }}>{APP_VERSION}</span>
                </div>
                <div>AI 多角色多情绪小说配音平台</div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tooltip title="GitHub 仓库">
                    <a
                      href="https://github.com/henxinli/HX-SayBook"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#6c7086', fontSize: 14 }}
                    >
                      <GithubOutlined />
                    </a>
                  </Tooltip>
                  <span style={{ color: '#45475a' }}>|</span>
                  <span>AGPL-3.0</span>
                </div>
              </div>
            ) : (
              <Tooltip title={`HX-SayBook ${APP_VERSION}`} placement="right">
                <div style={{ textAlign: 'center', color: '#6c7086', fontSize: 11, cursor: 'default' }}>
                  {APP_VERSION}
                </div>
              </Tooltip>
            )}

            {/* 收起/展开按钮 */}
            <div
              onClick={() => setCollapsed(!collapsed)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 8,
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: 6,
                color: '#a6adc8',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#313244')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 16 }} /> : <MenuFoldOutlined style={{ fontSize: 16 }} />}
              {!collapsed && <span style={{ fontSize: 13 }}>收起侧栏</span>}
            </div>
          </div>
        </div>
      </Sider>
      <Layout style={{ overflow: 'hidden' }}>
        <Content style={{ padding: 24, overflow: 'hidden', height: '100%' }}>
          <Routes>
            <Route path="/" element={<ProjectList />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/:id/*" element={<ProjectDetail />} />
            <Route path="/config" element={<ConfigCenter />} />
            <Route path="/voices" element={<VoiceManager />} />
            <Route path="/prompts" element={<PromptManager />} />
            <Route path="/voice-debug" element={<VoiceDebug />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
