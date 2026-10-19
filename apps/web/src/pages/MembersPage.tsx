import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { StatusDot } from '@/components/StatusDot';
import { Modal } from '@/components/Modal';
import { DataTable } from '@/components/DataTable';
import { errorText, getActorId } from '@/api/client';
import { memberApi } from '@/api/member.api';
import { useKbSpaces, useMembers, useModels, useSaveAgentConfig, useSkills } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { CAPABILITY, MEMBER_TYPE, type AgentConfig, type Member, type PermissionCapability } from '@/lib/shared';
import { capabilityLabel, memberRoleLabel } from '@/lib/labels';

const CONTEXT_STEPS = ['角色', '能力', '权限', '上下文', '配额', '发布'];
const SCOPE_OPTIONS = ['运营组项目', '投放规范、历史日报知识空间', '全部任务队列', '数据分析项目', '全部仓库（只读）'];

const DEFAULT_ROLE_PROMPT = '你是团队的执行助手，所有结论可溯源到数据或文档，无依据时明确说明，不编造数值。';
const DEFAULT_CONTEXT_PRIORITY = ['system', 'task', 'kb', 'history'];

/**
 * 组装成员配置的编辑草稿。
 * 对后端返回的 agentConfig 做「逐字段兜底」：缺失或为 null 的数组/数值都补默认值，
 * 避免「返回 null / 少传字段」这类输入把页面打崩（P0 类健壮性探测）。
 */
function defaultAgentConfig(m: Member): AgentConfig {
  const cfg = m.agentConfig;
  return {
    memberId: cfg?.memberId ?? m.id,
    rolePrompt: cfg?.rolePrompt ?? DEFAULT_ROLE_PROMPT,
    primaryModelId: cfg?.primaryModelId ?? undefined,
    fallbackModelIds: cfg?.fallbackModelIds ?? [],
    skillIds: cfg?.skillIds ?? [],
    toolIds: cfg?.toolIds ?? [],
    kbSpaceIds: cfg?.kbSpaceIds ?? [],
    declaredScope: cfg?.declaredScope ?? m.dataScope ?? [],
    contextBudget: cfg?.contextBudget ?? 8192,
    contextPriority: cfg?.contextPriority ?? DEFAULT_CONTEXT_PRIORITY,
    quotaMonthly: cfg?.quotaMonthly ?? 0,
    quotaUsed: cfg?.quotaUsed ?? 0,
    version: cfg?.version ?? 'v1.0',
    grayRatio: cfg?.grayRatio ?? 100,
  };
}

function AddMemberModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState('');
  const [type, setType] = useState<'human' | 'ai'>('ai');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      notify('请填写成员名称', 'err');
      return;
    }
    setBusy(true);
    try {
      await memberApi.create({ type, name: name.trim(), handle: handle || undefined, creatorId: getActorId() });
      qc.invalidateQueries({ queryKey: ['members'] });
      notify(`已添加成员「${name.trim()}」`, 'ok');
      onClose();
    } catch (e) {
      notify(`添加失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="添加成员"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" disabled={busy} onClick={submit}>
            添加
          </button>
        </>
      }
    >
      <div className="fld">
        <label>名称</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：日报生成 Agent" />
      </div>
      <div className="fld">
        <label>类型</label>
        <select value={type} onChange={(e) => setType(e.target.value as 'human' | 'ai')}>
          <option value="ai">AI 成员</option>
          <option value="human">人类成员</option>
        </select>
      </div>
      <div className="fld">
        <label>账号标识</label>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle（可选）" />
      </div>
      <div className="note">创建 AI 成员须绑定创建者；其有效权限 = min(自身声明, 创建者权限)。</div>
    </Modal>
  );
}

export function MembersPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const membersQuery = useMembers();
  const modelsQuery = useModels();
  const skillsQuery = useSkills();
  const spacesQuery = useKbSpaces();
  const saveConfig = useSaveAgentConfig();

  const members = membersQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState('上下文');
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [scope, setScope] = useState<string[]>([]);

  const selected = useMemo(
    () => members.find((m) => m.id === selectedId) ?? members.find((m) => m.type === MEMBER_TYPE.AI) ?? members[0],
    [members, selectedId],
  );

  useEffect(() => {
    if (selected) {
      setDraft(defaultAgentConfig(selected));
      setScope(selected.dataScope ?? []);
    }
  }, [selected?.id]);

  const modelName = (id?: string) => modelsQuery.data?.find((m) => m.id === id)?.name ?? '未配置';
  // 入参可能是 null（后端字段缺失），统一在 helper 内兜底
  const skillNames = (ids?: string[] | null) =>
    (ids ?? []).length
      ? (ids ?? []).map((id) => skillsQuery.data?.find((s) => s.id === id)?.name ?? id).join(' · ')
      : '无';
  const spaceNames = (ids?: string[] | null) =>
    (ids ?? []).length
      ? (ids ?? []).map((id) => spacesQuery.data?.find((s) => s.id === id)?.name ?? id).join(' · ')
      : '无';

  const save = async () => {
    if (!selected || !draft) return;
    try {
      await saveConfig.mutateAsync({ id: selected.id, body: { ...draft, declaredScope: scope } });
      await memberApi.update(selected.id, { dataScope: scope });
      qc.invalidateQueries({ queryKey: ['members'] });
      notify('已保存成员配置', 'ok');
    } catch (e) {
      notify(`保存失败：${errorText(e)}`, 'err');
    }
  };

  const toggleCapability = (cap: PermissionCapability) => {
    if (!draft) return;
    const current = draft.toolIds ?? [];
    setDraft({
      ...draft,
      toolIds: current.includes(cap) ? current.filter((x) => x !== cap) : [...current, cap],
    });
  };

  const columns = [
    {
      key: 'name',
      title: '成员',
      render: (m: Member) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Avatar text={m.avatarText || m.name.slice(0, 1)} type={m.type} />
          {m.name}
        </span>
      ),
    },
    { key: 'type', title: '类型', render: (m: Member) => (m.type === 'ai' ? 'AI 成员' : '人类') },
    { key: 'capabilityTags', title: '能力标签', render: (m: Member) => (m.capabilityTags ?? []).join(' · ') || '—' },
    { key: 'dataScope', title: '数据权限', render: (m: Member) => (m.dataScope ?? []).join('、') || '—' },
    { key: 'role', title: '角色', render: (m: Member) => memberRoleLabel[m.role] },
    {
      key: 'status',
      title: '',
      render: (m: Member) => (
        <StatusDot color={m.status === 'active' ? 'var(--st-5)' : 'var(--tx-3)'} title={m.status === 'active' ? '已启用' : '已停用'} />
      ),
    },
  ];

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          团队 / <b>成员</b>
        </div>
        <div className="tr">
          <button className="tb" disabled title="成员筛选本期未实现（可按类型用 /api/members?type= 查询）">
            筛选
          </button>
          <button className="tb pri" onClick={() => openOverlay('add-member')}>
            添加成员
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">成员</div>
        <div className="ps">人类与 AI 成员在同一协作体系中，具备各自的身份、权限与配额</div>
        <div className="note">
          <b>权限规则：</b>AI 成员的有效权限取 min(自身声明, 创建者权限)。创建者仅有空间 A 权限时，AI 成员声明全空间也仅在 A 内生效。
        </div>

        <div className="card">
          <div className="ch">
            <h3>成员列表</h3>
            <button className="tb" onClick={() => openOverlay('add-member')}>
              添加成员
            </button>
          </div>
          <DataTable
            columns={columns}
            rows={members}
            rowKey={(m) => m.id}
            loading={membersQuery.isLoading}
            error={membersQuery.isError ? errorText(membersQuery.error) : null}
            empty="暂无成员"
            onRowClick={(m) => {
              setSelectedId(m.id);
              notify(`已选中 ${m.name}`);
            }}
          />
        </div>

        {selected && draft && (
          <div className="card">
            <div className="ch">
              <h3>配置 · {selected.name}</h3>
              <div>
                <span style={{ fontSize: 12, color: 'var(--tx-3)', marginRight: 8 }}>{draft.version}</span>
                <button className="tb sm" disabled title="Agent 调试台本期未实现（技能页提供调试台）">
                  调试
                </button>{' '}
                <button className="tb sm pri" onClick={save}>
                  保存
                </button>
              </div>
            </div>

            <div className="steps">
              {CONTEXT_STEPS.map((s) => (
                <div key={s} className={`stp${s === step ? ' on' : CONTEXT_STEPS.indexOf(s) < CONTEXT_STEPS.indexOf(step) ? ' done' : ''}`} onClick={() => setStep(s)}>
                  {s}
                </div>
              ))}
            </div>

            <div className="row">
              <div className="cl2">
                <div className="lbl">角色定义</div>
                <textarea
                  value={draft.rolePrompt}
                  onChange={(e) => setDraft({ ...draft, rolePrompt: e.target.value })}
                  style={{
                    width: '100%',
                    minHeight: 60,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r)',
                    padding: '8px 10px',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    resize: 'none',
                    lineHeight: 1.6,
                  }}
                />
              </div>

              <div className="cl2">
                <div className="lbl">能力</div>
                <table>
                  <tbody>
                    <tr>
                      <td style={{ width: 76, color: 'var(--tx-3)' }}>模型</td>
                      <td>{modelName(draft.primaryModelId)}（主力）</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--tx-3)' }}>技能</td>
                      <td>{skillNames(draft.skillIds)}</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--tx-3)' }}>知识库</td>
                      <td>{spaceNames(draft.kbSpaceIds)}</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--tx-3)' }}>上下文</td>
                      <td>{((draft.contextBudget ?? 0) / 1024).toFixed(0)}K tokens</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="cl2">
                <div className="lbl">数据权限（未勾选即不可访问）</div>
                {SCOPE_OPTIONS.map((s) => (
                  <div
                    key={s}
                    className={`bx${scope.includes(s) ? ' on' : ''}`}
                    onClick={() => setScope((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                  >
                    <span className={`sdot${scope.includes(s) ? ' on' : ''}`}>{scope.includes(s) ? '✓' : ''}</span>
                    <span style={scope.includes(s) ? undefined : { color: 'var(--tx-3)' }}>{s}</span>
                  </div>
                ))}
              </div>

              <div className="cl2">
                <div className="lbl">权限声明 · 能力白名单</div>
                {(Object.values(CAPABILITY) as PermissionCapability[]).map((c) => {
                  const on = (draft.toolIds ?? []).includes(c);
                  return (
                    <div key={c} className={`bx${on ? ' on' : ''}`} onClick={() => toggleCapability(c)}>
                      <span className={`sdot${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
                      <span style={on ? undefined : { color: 'var(--tx-3)' }}>{capabilityLabel[c]}</span>
                    </div>
                  );
                })}
              </div>

              <div className="cl2">
                <div className="lbl">上下文预算 · {((draft.contextBudget ?? 0) / 1024).toFixed(0)}K tokens（超限按序压缩）</div>
                {(draft.contextPriority ?? []).map((p, i) => (
                  <div className="bx on" key={p}>
                    <span className="sdot on">✓</span>
                    {i + 1} {p === 'system' ? '系统指令（保留）' : p === 'task' ? '任务描述（保留）' : p === 'kb' ? '知识检索结果（先压缩）' : '历史对话（截断）'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {overlay?.name === 'add-member' && <AddMemberModal onClose={closeOverlay} />}
    </>
  );
}

export default MembersPage;
