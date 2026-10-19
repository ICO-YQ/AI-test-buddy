import type { CSSProperties } from 'react';

export interface AvatarProps {
  /** 头像文字（1 个汉字或字母） */
  text: string;
  /** 成员类型：AI 用靛蓝底，人类用灰底 —— 同一套视觉规则，仅底色不同 */
  type?: 'human' | 'ai';
  /** 覆盖底色 */
  color?: string;
  size?: 'sm' | 'md';
  title?: string;
  style?: CSSProperties;
}

/**
 * 圆形头像。AI 成员与人类成员尺寸一致，不使用「AI」文字徽章，不做拟人化。
 */
export function Avatar({ text, type = 'human', color, size = 'sm', title, style }: AvatarProps) {
  const bg = color ?? (type === 'ai' ? 'var(--ac)' : 'var(--st-2)');
  return (
    <span className={`av${size === 'sm' ? ' sm' : ''}`} style={{ background: bg, ...style }} title={title}>
      {text}
    </span>
  );
}

export default Avatar;
