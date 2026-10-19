import { useNavigate } from 'react-router-dom';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <>
      <div className="topbar">
        <div className="crumb">
          工作 / <b>未找到</b>
        </div>
      </div>
      <div className="pg on">
        <div className="pt">404</div>
        <div className="ps">页面不存在或已被移除。</div>
        <button className="tb pri" onClick={() => navigate('/board')}>
          返回看板
        </button>
      </div>
    </>
  );
}

export default NotFound;
