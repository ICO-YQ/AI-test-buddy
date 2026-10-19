import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { errorText } from '@/api/client';
import { govApi } from '@/api/gov.api';
import { useAudit, useSecurityEvents } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { dateTime, duration, timeOnly, tokens } from '@/lib/format';
import { auditResultColor, auditResultLabel } from '@/lib/labels';
import type { AuditLog, SecurityEventStat } from '@/lib/shared';

const EXCEPTIONS = [
  ['沙箱启动失败', '重试 2 次后挂起'],
  ['主力模型不可用', '自动降级'],
  ['检索依据不足', '显式声明'],
  ['接口超限流', '429 + 重试建议'],
  ['审计写入失败', '阻断敏感操作'],
];

export function AuditPage() {
  const notify = useUiStore((s) => s.notify);
  const auditQuery = useAudit();
  const securityQuery = useSecurityEvents();

  const [traceId, setTraceId] = useState('');
  const [traceRows, setTraceRows] = useState<AuditLog[] | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);

  const replay = async (tid?: string) => {
    const id = (tid ?? traceId).trim();
    if (!id) {
      notify('请输入 TraceID', 'err');
      return;
    }
    setTraceBusy(true);
    try {
      const rows = (await govApi.trace(id)) ?? [];
      setTraceRows(rows);
      notify(rows.length ? `已回放 ${rows.length} 条链路记录` : '未找到该 TraceID 的记录', rows.length ? 'ok' : 'warn');
    } catch (e) {
      setTraceRows(null);
      notify(`回放失败：${errorText(e)}`, 'err');
    } finally {
      setTraceBusy(false);
    }
  };

  const items = auditQuery.data?.items ?? [];
  // 双主体留痕：执行主体 + 发起人两列
  const columns = [
    { key: 'occurredAt', title: '时间', render: (l: AuditLog) => timeOnly(l.occurredAt) },
    {
      key: 'actorName',
      title: '主体',
      render: (l: AuditLog) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={`sdot${l.actorType === 'ai' ? ' on' : ''}`} style={{ borderColor: l.actorType === 'ai' ? 'var(--ac)' : 'var(--line-3)', background: l.actorType === 'ai' ? 'var(--ac)' : 'transparent' }}>
            {l.actorType === 'ai' ? '' : ''}
          </span>
          {l.actorName ?? l.actorId ?? '—'}
        </span>
      ),
    },
    { key: 'initiatorName', title: '发起人', render: (l: AuditLog) => l.initiatorName ?? l.initiatorId ?? '—' },
    { key: 'action', title: '动作', render: (l: AuditLog) => l.action },
    { key: 'resourceName', title: '资源', render: (l: AuditLog) => l.resourceName ?? l.resourceId ?? '—' },
    { key: 'durationMs', title: '耗时', render: (l: AuditLog) => (l.durationMs != null ? duration(l.durationMs) : '—') },
    { key: 'tokenUsed', title: 'Token', render: (l: AuditLog) => (l.tokenUsed != null ? tokens(l.tokenUsed) : '—') },
    {
      key: 'result',
      title: '结果',
      render: (l: AuditLog) => <span style={{ color: auditResultColor[l.result] }}>{auditResultLabel[l.result]}</span>,
    },
  ];

  const firstTrace = items[0]?.traceId;

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          设置 / <b>审计日志</b>
        </div>
        <div className="tr">
          {firstTrace && (
            <button className="tb" onClick={() => void replay(firstTrace)}>
              回放最近链路
            </button>
          )}
          <button className="tb" disabled title="审计导出本期未实现（可复制表格内容）">
            导出
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">审计日志</div>
        <div className="ps">全链路追踪 · 双主体留痕 · 不可篡改</div>
        <div className="note">
          <b>留痕规则：</b>所有 AI 成员行为同时记录执行主体与发起人。审计写入失败时阻断敏感操作。
        </div>

        <div className="card">
          <div className="ch">
            <h3>Trace 回放</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                placeholder="输入 TraceID，例如 tr-9f2a7c"
                onKeyDown={(e) => e.key === 'Enter' && void replay()}
                style={{
                  height: 28,
                  width: 220,
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  padding: '0 10px',
                  fontSize: 12.5,
                }}
              />
              <button className="tb" disabled={traceBusy} onClick={() => void replay()}>
                {traceBusy ? '回放中…' : '回放'}
              </button>
            </div>
          </div>

          {traceRows && (
            <>
              <div className="sct">Trace {traceRows[0]?.traceId}</div>
              <DataTable columns={columns} rows={traceRows} rowKey={(l) => l.id} empty="该链路暂无记录" />
            </>
          )}

          {!traceRows && (
            <>
              <div className="sct">全部审计记录</div>
              <DataTable
                columns={columns}
                rows={items}
                rowKey={(l) => l.id}
                loading={auditQuery.isLoading}
                error={auditQuery.isError ? errorText(auditQuery.error) : null}
                empty="暂无审计记录"
                onRowClick={(l) => void replay(l.traceId)}
              />
            </>
          )}
        </div>

        <div className="row">
          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>安全事件</h3>
                <span style={{ fontSize: 12, color: 'var(--ok)' }}>无高危</span>
              </div>
              <DataTable
                columns={[
                  { key: 'type', title: '类型', render: (e: SecurityEventStat) => e.type },
                  { key: 'today', title: '今日', render: (e: SecurityEventStat) => String(e.today) },
                  { key: 'month', title: '本月', render: (e: SecurityEventStat) => String(e.month) },
                ]}
                rows={securityQuery.data ?? []}
                rowKey={(e) => e.type}
                loading={securityQuery.isLoading}
                error={securityQuery.isError ? errorText(securityQuery.error) : null}
                empty="暂无安全事件"
              />
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>异常处理</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>预置 {EXCEPTIONS.length} 项</span>
              </div>
              <table>
                <tbody>
                  {EXCEPTIONS.map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td style={{ color: 'var(--tx-2)' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="ch">
                <h3>留存</h3>
              </div>
              <div className="kv2">
                <span className="k">留存期</span>
                <span className="v">180 天</span>
              </div>
              <div className="kv2">
                <span className="k">最近记录</span>
                <span className="v">{items[0] ? dateTime(items[0].occurredAt) : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default AuditPage;
