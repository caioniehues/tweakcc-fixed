import { describe, expect, it, vi } from 'vitest';

import { writeMultiSkillInvocation } from './multiSkillInvocation';

// Stock 2.1.195 `Ocl` gate. Names (Ocl, n, r, o, s, i, xk, zw, NM) churn across
// versions, but the shape — the lookbehind/slash/lookahead RegExp, the
// per-message loop, and the `typeof s==="string"` skip of skill-format messages
// — is stable.
const OCL =
  'function Ocl(e,t){if(t.agentId!==void 0)return!1;' +
  'let n=new RegExp(`(?<!\\\\S)/${xk(e)}(?=$|\\\\s)`);' +
  'for(let r=t.messages.length-1;r>=t.turnStartIndex;r--){' +
  'let o=t.messages[r];if(o.type!=="user"||o.isMeta)continue;' +
  'let s=o.message.content;' +
  'if(typeof s==="string"){if(s.includes(`<${zw}>`))continue}' +
  'else if(s.some((i)=>i.type==="tool_result"))continue;' +
  'if(n.test(NM(o)??""))return!0}return!1}';

describe('multiSkillInvocation', () => {
  it('rewrites the skill-format skip to scan <command-args> and permit on match', () => {
    const result = writeMultiSkillInvocation(OCL);

    expect(result).not.toBeNull();
    // The wholesale `continue` skip is replaced by an args scan that reuses the
    // original regex var (n) and the message-content var (s).
    expect(result).toContain(
      'if(s.includes(`<${zw}>`)){let __tcMsiArgs=s.match(/<command-args>([\\s\\S]*?)<\\/command-args>/);if(__tcMsiArgs&&n.test(__tcMsiArgs[1]))return!0;continue}'
    );
    // Everything else is preserved untouched.
    expect(result).toContain('if(t.agentId!==void 0)return!1;');
    expect(result).toContain('else if(s.some((i)=>i.type==="tool_result"))');
    expect(result).toContain('if(n.test(NM(o)??""))return!0');
  });

  it('preserves minifier-renamed identifiers (different var names)', () => {
    // linux-arm64-style rename: Ocl→$h2, n→$R, s→$c, zw→$T, xk→$e, NM→$N.
    const renamed =
      'function $h2(a,b){if(b.agentId!==void 0)return!1;' +
      'let $R=new RegExp(`(?<!\\\\S)/${$e(a)}(?=$|\\\\s)`);' +
      'for(let $i=b.messages.length-1;$i>=b.turnStartIndex;$i--){' +
      'let $o=b.messages[$i];if($o.type!=="user"||$o.isMeta)continue;' +
      'let $c=$o.message.content;' +
      'if(typeof $c==="string"){if($c.includes(`<${$T}>`))continue}' +
      'else if($c.some((z)=>z.type==="tool_result"))continue;' +
      'if($R.test($N($o)??""))return!0}return!1}';

    const result = writeMultiSkillInvocation(renamed);

    expect(result).not.toBeNull();
    expect(result).toContain(
      'if($c.includes(`<${$T}>`)){let __tcMsiArgs=$c.match(/<command-args>([\\s\\S]*?)<\\/command-args>/);if(__tcMsiArgs&&$R.test(__tcMsiArgs[1]))return!0;continue}'
    );
  });

  it('is a no-op when already patched (idempotent)', () => {
    const once = writeMultiSkillInvocation(OCL);
    expect(once).not.toBeNull();
    expect(writeMultiSkillInvocation(once as string)).toBe(once);
  });

  it('returns null when the gate shape is absent', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      expect(writeMultiSkillInvocation('const x=1;')).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        'patch: multiSkillInvocation: failed to find the skill-invocation gate (Ocl)'
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
