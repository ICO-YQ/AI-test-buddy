/**
 * Hub 远程客户端（HubClient）
 *
 * 铁律（§4.6）：Hub 只同步**元数据**，不落盘；执行一律走沙箱。
 *
 * REPLACE_POINT: 当前为 `MockHubClient` —— 返回预置元数据与**模拟签名**，
 * 不真实发起网络请求。未来替换点：接入真实 Git / HTTP / Registry 源，
 * 实现包体校验、签名验签（cosign / GPG）、增量索引。
 *
 * 接口签名稳定：`fetchMetadata(input) → HubMetadata`
 */

import { createHash } from 'node:crypto';

import type { HubRepo, HubSkill, PermissionDecl, TrustLevel } from '@huanbuddy/shared';

export interface HubFetchInput {
  repo: HubRepo;
  skill: HubSkill;
}

export interface HubMetadata {
  skillId: string;
  repoId: string;
  name: string;
  slug: string;
  version: string;
  tags: string[];
  /** 仅元数据，不含脚本内容 */
  permissions: PermissionDecl[];
  /** 包体大小（字节），仅元数据 */
  sizeBytes: number;
  lang?: string;
  /** 模拟签名（sha256 摘要截断） */
  signature: string;
  /** 签名校验结果 */
  signatureOk: boolean;
  trustLevel: TrustLevel;
  fetchedAt: string;
  /** 数据来源：remote（新拉取）/ cache（缓存命中） */
  source: 'remote' | 'cache';
}

export interface HubClient {
  fetchMetadata(input: HubFetchInput): HubMetadata;
}

/** 可校验的签名种子（替换为真实公钥验签） */
const SIGNATURE_SEED = 'huanbuddy-hub-signature-v1';

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class MockHubClient implements HubClient {
  fetchMetadata(input: HubFetchInput): HubMetadata {
    const { repo, skill } = input;

    const payload = `${SIGNATURE_SEED}|${repo.id}|${skill.slug}|${skill.version}`;
    const signature = createHash('sha256').update(payload).digest('hex').slice(0, 32);

    // 签名校验：
    //  - 仓库未要求签名 → 视为通过
    //  - 要求签名 → 依据索引中记录的 signature_ok（null 表示尚未核验 = 未通过）
    const signatureOk = repo.signatureRequired ? skill.signatureOk === true : true;

    const cachedMeta = (skill.cachedMeta ?? {}) as { sizeBytes?: number; lang?: string };

    return {
      skillId: skill.id,
      repoId: repo.id,
      name: skill.name,
      slug: skill.slug,
      version: skill.version,
      tags: skill.tags,
      permissions: skill.permissions,
      sizeBytes: Number(cachedMeta.sizeBytes ?? 0),
      lang: cachedMeta.lang,
      signature,
      signatureOk,
      trustLevel: repo.trustLevel,
      fetchedAt: isoNow(),
      source: skill.cacheExpireAt && new Date(skill.cacheExpireAt) > new Date() ? 'cache' : 'remote',
    };
  }
}

export const mockHubClient = new MockHubClient();
