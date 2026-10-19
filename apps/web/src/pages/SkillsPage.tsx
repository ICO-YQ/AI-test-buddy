import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { errorText, getActorId } from '@/api/client';
import { skillApi } from '@/api/skill.api';
import { useSkill, useSkills } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { CAPABILITY, type PermissionCapability, type Skill, type SkillVersion } from '@/lib/shared';
import { capabilityLabel, skillStatusLabel, trustLevelLabel } from '@/lib/labels';

const STEPS = ['信息', '输入输出', '实现', '权限', '验证', '发布'];

function SchemaTable({ schema, empty }: { schema?: Record<string, unknown>; empty: string }) {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema?.required ?? []) as string[];
  const rows = Object.entries(props).map(([key, v]) => ({
    key,
    type: String(v.type ?? '—'),
    required: required.includes(key),
    desc: String(v.description ?? '—'),
  }));
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>类型</th>
          <th>必填</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td>{r.type}</td>
            <td>{r.required ? '是' : '否'}</td>
            <td>{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkillsPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);

  const listQuery = useSkills();
  const skills = listQuery.data ?? [];
  const activeId = skillId ?? skills[0]?.id ?? null;
  const detailQuery = useSkill(activeId);
  const skill = detailQuery.data;

  const [step, setStep] = useState('实现');
  const [debugInput, setDebugInput] = useState('{\n  "channel": "douyin",\n  "date_range": "2026-09-01~2026-09-30"\n}');
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const versions: SkillVersion[] = skill?.versions ?? [];
  const current = useMemo(
    () => versions.find((v) => v.version === skill?.currentVersion) ?? versions[0],
    [versions, skill?.currentVersion],
  );

  const [perms, setPerms] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const init: Record<string, boolean> = {};
    for (const c of Object.values(CAPABILITY) as PermissionCapability[]) {
      init[c] = (current?.permissions ?? []).find((p) => p.capability === c)?.granted ?? false;
    }
    setPerms(init);
  }, [current?.id]);

  const runDebug = async () => {
    if (!skill || !current) {
      notify('请选择技能与版本', 'err');
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(debugInput);
    } catch {
      notify('输入不是合法 JSON', 'err');
      return;
    }
    setBusy(true);
    setDebugResult(null);
    try {
      const r = await skillApi.execute(skill.id, current.id, parsed);
      setDebugResult(
        [
          `status: ${r.status}`,
          r.blockReason ? `block_reason: ${r.blockReason}` : null,
          `duration: ${r.durationMs}ms`,
          `本地落盘: ${r.localFiles} 文件`,
          r.traceId ? `trace: ${r.traceId}` : null,
          `output: ${JSON.stringify(r.output ?? {}, null, 2)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      notify(r.status === 'success' ? '调试完成' : `执行被阻断：${r.blockReason ?? r.status}`, r.status === 'success' ? 'ok' : 'err');
    } catch (e) {
      setDebugResult(`error: ${errorText(e)}`);
      notify(`执行失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!skill || !current) return;
    try {
      await skillApi.publish(skill.id, current.version);
      qc.invalidateQueries({ queryKey: ['skill', skill.id] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      notify(`已发布 ${current.version}`, 'ok');
    } catch (e) {
      notify(`发布失败：${errorText(e)}`, 'err');
    }
  };

  const validate = async () => {
    if (!skill || !current) return;
    try {
      const r = await skillApi.validate(skill.id, current.id);
      notify(r.pass ? '静态检查通过，未检出高危调用' : `校验未通过：${r.permissionIssues.concat(r.staticIssues.map((i) => `L${i.line} ${i.msg}`)).join('；')}`, r.pass ? 'ok' : 'err');
    } catch (e) {
      notify(`校验失败：${errorText(e)}`, 'err');
    }
  };

  const togglePerm = (c: PermissionCapability) => setPerms((p) => ({ ...p, [c]: !p[c] }));

  const savePerms = async () => {
    if (!skill || !current) return;
    try {
      // 契约无「就地更新版本」端点，按 §4.5 生成携带新权限声明的新版本
      const [maj, min, pat] = current.version.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
      const nextVersion = `v${maj}.${min}.${pat + 1}`;
      await skillApi.savePermissions(
        skill.id,
        nextVersion,
        (Object.values(CAPABILITY) as PermissionCapability[]).map((c) => ({ capability: c, granted: !!perms[c] })),
        getActorId(),
      );
      qc.invalidateQueries({ queryKey: ['skill', skill.id] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      notify(`权限声明已保存为新版本 ${nextVersion}（未声明即禁止）`, 'ok');
    } catch (e) {
      notify(`保存失败：${errorText(e)}`, 'err');
    }
  };

  const listColumns = [
    { key: 'name', title: '技能', render: (s: Skill) => s.name },
    { key: 'source', title: '来源', render: (s: Skill) => (s.source === 'hub' ? 'Hub' : '本地') },
    { key: 'currentVersion', title: '版本', render: (s: Skill) => s.currentVersion ?? '—' },
    { key: 'status', title: '状态', render: (s: Skill) => skillStatusLabel[s.status] },
    { key: 'trustLevel', title: '信任', render: (s: Skill) => trustLevelLabel[s.trustLevel] },
  ];

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          团队 / <b>技能库</b>
        </div>
        <div className="tr">
          <button className="tb" disabled title="创建技能向导本期未实现（技能经 /api/skills 注册）">
            新建技能
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">技能库</div>
        <div className="ps">创建 · 调试 · 版本管理 · 权限声明</div>

        <div className="card">
          <div className="ch">
            <h3>技能列表</h3>
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{skills.length} 个</span>
          </div>
          <DataTable
            columns={listColumns}
            rows={skills}
            rowKey={(s) => s.id}
            loading={listQuery.isLoading}
            error={listQuery.isError ? errorText(listQuery.error) : null}
            empty="暂无技能"
            onRowClick={(s) => navigate(`/skills/${s.id}`)}
          />
        </div>

        <div className="row">
          <div className="cl2" style={{ flex: 1.35 }}>
            <div className="card">
              <div className="ch">
                <h3>{skill?.name ?? '技能详情'}</h3>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)', marginRight: 8 }}>
                    {current ? `${current.version} · ${skillStatusLabel[current.status]}` : '—'}
                  </span>
                  <button className="tb sm" disabled title="变更记录本期未实现（版本表已列出版本与影响面）">
                    变更记录
                  </button>{' '}
                  <button className="tb sm" onClick={validate}>
                    校验
                  </button>{' '}
                  <button className="tb sm pri" onClick={publish}>
                    发布
                  </button>
                </div>
              </div>

              <div className="steps">
                {STEPS.map((s) => (
                  <div key={s} className={`stp${s === step ? ' on' : STEPS.indexOf(s) < STEPS.indexOf(step) ? ' done' : ''}`} onClick={() => setStep(s)}>
                    {s}
                  </div>
                ))}
              </div>

              <div className="lbl">输入 Schema</div>
              {detailQuery.isLoading && <div className="empty"><span className="spin" /> 加载中…</div>}
              {detailQuery.isError && <div className="empty">⚠ {errorText(detailQuery.error)}</div>}
              {skill && <SchemaTable schema={current?.inputSchema} empty="未定义输入 Schema" />}

              <div className="lbl" style={{ marginTop: 12 }}>
                输出 Schema
              </div>
              {skill && <SchemaTable schema={current?.outputSchema} empty="未定义输出 Schema" />}

              {current?.staticCheck && (
                <div className={`al ${current.staticCheck.pass ? 'ok' : 'err'}`} style={{ marginTop: 11 }}>
                  <span className="i">{current.staticCheck.pass ? '✓' : '✕'}</span>
                  <span>
                    {current.staticCheck.pass
                      ? '静态检查通过，未检出高危调用。'
                      : `检出 ${(current.staticCheck.issues ?? []).length} 项问题：${(current.staticCheck.issues ?? []).map((i) => `L${i.line} ${i.msg}`).join('；')}`}
                  </span>
                </div>
              )}
            </div>

            <div className="card">
              <div className="ch">
                <h3>调试台</h3>
                <button className="tb sm pri" disabled={busy} onClick={runDebug}>
                  {busy ? '执行中…' : '执行'}
                </button>
              </div>
              <div className="lbl">输入（JSON）</div>
              <textarea
                value={debugInput}
                onChange={(e) => setDebugInput(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 88,
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  padding: '8px 10px',
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                  fontSize: 12,
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
              />
              {debugResult && (
                <>
                  <div className="lbl" style={{ marginTop: 10 }}>
                    执行结果
                  </div>
                  <div className="kbox">{debugResult}</div>
                </>
              )}
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>权限声明</h3>
                <span style={{ fontSize: 12, color: 'var(--warn)' }}>发布前校验</span>
              </div>
              {(Object.values(CAPABILITY) as PermissionCapability[]).map((c) => {
                const on = !!perms[c];
                const detail = (current?.permissions ?? []).find((p) => p.capability === c)?.detail;
                return (
                  <div key={c} className={`bx${on ? ' on' : ''}`} onClick={() => togglePerm(c)}>
                    <span className={`sdot${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
                    <span style={{ flex: 1, color: on ? undefined : 'var(--tx-3)' }}>{capabilityLabel[c]}</span>
                    <span style={{ color: on ? 'var(--tx-3)' : 'var(--tx-4)', fontSize: 11.5 }}>{on ? detail ?? '已声明' : '未声明'}</span>
                  </div>
                );
              })}
              <div className="note" style={{ margin: '9px 0 0' }}>未声明即禁止。运行期越界由沙箱阻断并记审计。</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                <button className="tb sm pri" onClick={savePerms}>
                  保存声明
                </button>
                <button className="tb sm" onClick={validate}>
                  校验
                </button>
              </div>
            </div>

            <div className="card">
              <div className="ch">
                <h3>版本</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{versions.length} 个</span>
              </div>
              <DataTable
                columns={[
                  { key: 'version', title: '版本', render: (v: SkillVersion) => v.version },
                  { key: 'status', title: '状态', render: (v: SkillVersion) => skillStatusLabel[v.status] },
                  {
                    key: 'act',
                    title: '',
                    render: (v: SkillVersion) => (
                      <button
                        className="tb sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!skill) return;
                          try {
                            const r = await skillApi.impact(skill.id, v.version);
                            const agents = r.referencedByAgents ?? [];
                            const workflows = r.referencedByWorkflows ?? [];
                            notify(`影响面：${agents.length} 成员 / ${workflows.length} 流程${r.blocked ? ' · 被引用不可下线' : ''}`, r.blocked ? 'warn' : 'info');
                          } catch (err) {
                            notify(`影响面查询失败：${errorText(err)}`, 'err');
                          }
                        }}
                      >
                        影响面
                      </button>
                    ),
                  },
                ]}
                rows={versions}
                rowKey={(v) => v.id}
                empty="暂无版本"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default SkillsPage;
