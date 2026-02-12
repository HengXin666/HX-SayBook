import {
    AudioOutlined,
    BugOutlined,
    FileTextOutlined,
    ProjectOutlined,
    SettingOutlined,
    SoundOutlined,
} from '@ant-design/icons';
import { Layout, Menu } from 'antd';
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

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // 获取当前选中的菜单key
  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '/projects';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} style={{ borderRight: '1px solid #313244' }}>
        <div className="logo-title">
          <AudioOutlined style={{ fontSize: 24 }} />
          HX-SayBook
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 'none' }}
        />
      </Sider>
      <Layout>
        <Content style={{ padding: 24, overflow: 'auto' }}>
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
