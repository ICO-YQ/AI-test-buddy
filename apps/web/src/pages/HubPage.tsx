import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { errorText } from '@/api/client';
import { hubApi } from '@/api/hub.api';
import { useHubRepos, useHubSkills } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { TRUST_LEVEL, type HubRepo, type HubSkill, type TrustLevel } from '@/lib/shared';
import { trustLevelLabel } from '@/lib/labels';

const SECURITY_GATES = [
  '来源白名单',
  '签名校验',
  '危险调用扫描',
  '权限声明校验',
  '沙箱强制执行',
  '人工审核（社区源）',
  '一键停用',
];

function AddRepoModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<HubRepo['type']>('git');
  const [trust, setTrust] = useState<TrustLevel>(TRUST_LEVEL.ORG);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !url.trim()) {
      notify('请填写仓库名称与地址', 'err');
      return;
    }
    setBusy(true);
    try {
      await hubApi.createRepo({ name: name.trim(), url: url.trim(), type, trustLevel: trust, signatureRequired: true });
      qc.invalidateQueries({ queryKey: ['hub-repos'] });
      notify(`已注册仓库「${name.trim()}」`, 'ok');
      onClose();
    } catch (e) {
      notify(`注册失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="添加仓库"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" disabled={busy} onClick={submit}>
            注册
          </button>
        </>
      }
    >
      <div className="fld">
        <label>名称</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：platform-official" />
      </div>
      <div className="fld">
        <label>地址</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="git@… 或 https://…" />
      </div>
      <div className="fld">
        <label>类型</label>
        <select value={type} onChange={(e) => setType(e.target.value as HubRepo['type'])}>
          <option value="git">Git</option>
          <option value="http">HTTP 索引</option>
          <option value="registry">内部制品库</option>
        </select>
      </div>
      <div className="fld">
        <label>信任等级</label>
        <select value={trust} onChange={(e) => setTrust(e.target.value as TrustLevel)}>
          <option value="official">官方</option>
          <option value="org">组织内</option>
          <option value="community">社区</option>
        </select>
      </div>
    </Modal>
  );
}

export function HubPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const [q, setQ] = useState('');

  const reposQuery = useHubRepos();
  const skillsQuery = useHubSkills();

  const repos = reposQuery.data ?? [];
  const allSkills = skillsQuery.data ?? [];
  const skills = q ? allSkills.filter((s) => s.name.includes(q) || s.slug.includes(q)) : allSkills;

  const syncRepo = async (repo: HubRepo) => {
    try {
      const r = await hubApi.syncRepo(repo.id);
      qc.invalidateQueries({ queryKey: ['hub-repos'] });
      notify(`已同步 ${repo.name}：成功 ${r.synced}，失败 ${r.failed}`, 'ok');
    } catch (e) {
      notify(`同步失败：${errorText(e)}`, 'err');
    }
  };

  const toggleRepo = async (repo: HubRepo) => {
    try {
      await hubApi.updateRepo(repo.id, { status: repo.status === 'active' ? 'disabled' : 'active' });
      qc.invalidateQueries({ queryKey: ['hub-repos'] });
      notify(repo.status === 'active' ? `已停用 ${repo.name}` : `已启用 ${repo.name}`, 'warn');
    } catch (e) {
      notify(`操作失败：${errorText(e)}`, 'err');
    }
  };

  const loadSkill = async (skill: HubSkill) => {
    try {
      const r = await hubApi.load(skill.id);
      notify(`已加载 ${skill.name}：信任=${trustLevelLabel[r.trustLevel]}，签名=${r.signatureOk ? '通过' : '失败'}，${r.sandboxRequired ? '需沙箱执行' : ''}`, 'ok');
    } catch (e) {
      notify(`加载失败：${errorText(e)}`, 'err');
    }
  };

  const disableSkill = async (skill: HubSkill) => {
    try {
      await hubApi.disable(skill.id);
      qc.invalidateQueries({ queryKey: ['hub-skills'] });
      notify(`已一键熔断 ${skill.name}`, 'warn');
    } catch (e) {
      notify(`熔断失败：${errorText(e)}`, 'err');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          团队 / <b>技能市场</b>
        </div>
        <div className="tr">
          <button
            className="tb"
            disabled={repos.length === 0}
            title="同步全部仓库索引"
            onClick={async () => {
              let ok = 0;
              let failed = 0;
              for (const r of repos) {
                try {
                  await hubApi.syncRepo(r.id);
                  ok += 1;
                } catch {
                  failed += 1;
                }
              }
              qc.invalidateQueries({ queryKey: ['hub-repos'] });
              qc.invalidateQueries({ queryKey: ['hub-skills'] });
              notify(`索引同步完成：成功 ${ok} 个仓库${failed ? `，失败 ${failed} 个` : ''}`, failed ? 'warn' : 'ok');
            }}
          >
            刷新索引
          </button>
          <button className="tb pri" onClick={() => openOverlay('add-repo')}>
            添加仓库
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">技能市场</div>
        <div className="ps">远程仓库直读 · 不落盘 · 三级信任</div>
        <div className="note">
          <b>免下载不等于免执行。</b>平台仅同步元数据用于检索，实际使用时装入沙箱执行，本地工作区不落文件。
        </div>

        <div className="card">
          <div className="ch">
            <h3>仓库</h3>
            <button className="tb" onClick={() => openOverlay('add-repo')}>
              添加仓库
            </button>
          </div>
          <DataTable
            columns={[
              { key: 'name', title: '仓库', render: (r: HubRepo) => r.name },
              { key: 'type', title: '类型', render: (r: HubRepo) => r.type.toUpperCase() },
              { key: 'trustLevel', title: '信任等级', render: (r: HubRepo) => trustLevelLabel[r.trustLevel] },
              { key: 'sig', title: '签名校验', render: (r: HubRepo) => (r.signatureRequired ? '强制' : '可选') },
              { key: 'skillCount', title: '技能数', render: (r: HubRepo) => String(r.skillCount) },
              { key: 'lastSyncAt', title: '同步', render: (r: HubRepo) => (r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString('zh-CN') : '未同步') },
              {
                key: 'ops',
                title: '',
                render: (r: HubRepo) => (
                  <span style={{ display: 'flex', gap: 5 }}>
                    <button className="tb sm" onClick={(e) => { e.stopPropagation(); void syncRepo(r); }}>
                      同步
                    </button>
                    <button className="tb sm" onClick={(e) => { e.stopPropagation(); void toggleRepo(r); }}>
                      {r.status === 'active' ? '停用' : '启用'}
                    </button>
                  </span>
                ),
              },
            ]}
            rows={repos}
            rowKey={(r) => r.id}
            loading={reposQuery.isLoading}
            error={reposQuery.isError ? errorText(reposQuery.error) : null}
            empty="暂无仓库"
          />
        </div>

        <div className="row">
          <div className="cl2" style={{ flex: 1.35 }}>
            <div className="card">
              <div className="ch">
                <h3>可用技能</h3>
                <input
                  className=""
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索技能…"
                  style={{
                    height: 26,
                    width: 150,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r)',
                    padding: '0 10px',
                    fontSize: 12.5,
                  }}
                />
              </div>
              <DataTable
                columns={[
                  { key: 'name', title: '技能', render: (s: HubSkill) => s.name },
                  {
                    key: 'repo',
                    title: '来源',
                    render: (s: HubSkill) => repos.find((r) => r.id === s.repoId)?.name ?? s.repoId,
                  },
                  { key: 'version', title: '版本', render: (s: HubSkill) => s.version },
                  { key: 'installCount', title: '安装量', render: (s: HubSkill) => (s.installCount ?? 0).toLocaleString('zh-CN') },
                  { key: 'successRate', title: '成功率', render: (s: HubSkill) => (s.successRate != null ? `${(s.successRate * 100).toFixed(1)}%` : '—') },
                  {
                    key: 'trust',
                    title: '信任',
                    render: (s: HubSkill) =>
                      s.reviewStatus === 'approved' ? '已通过' : s.reviewStatus === 'rejected' ? '已驳回' : '待审核',
                  },
                  {
                    key: 'ops',
                    title: '',
                    render: (s: HubSkill) => (
                      <span style={{ display: 'flex', gap: 5 }}>
                        <button className="tb sm" onClick={() => void loadSkill(s)}>
                          调用
                        </button>
                        <button className="tb sm" onClick={() => void disableSkill(s)}>
                          熔断
                        </button>
                      </span>
                    ),
                  },
                ]}
                rows={skills}
                rowKey={(s) => s.id}
                loading={skillsQuery.isLoading}
                error={skillsQuery.isError ? errorText(skillsQuery.error) : null}
                empty="暂无技能索引"
              />
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>安全检查</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{SECURITY_GATES.length} 道闸门</span>
              </div>
              {SECURITY_GATES.map((g) => (
                <div className="step" key={g}>
                  <span className="sdot on">✓</span>
                  {g}
                </div>
              ))}
            </div>
            <div className="card">
          <div className="ch">
            <h3>本地落盘检查</h3>
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>随技能执行自动校验</span>
          </div>
              <div className="al ok">
                <span className="i">✓</span>
                <span>远程技能一律在服务端沙箱执行，本地工作区无落盘文件。</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {overlay?.name === 'add-repo' && <AddRepoModal onClose={closeOverlay} />}
    </>
  );
}

export default HubPage;
