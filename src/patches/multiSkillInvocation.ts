// Please see the note about writing patches in ./index
//
// Multi-skill invocation: honor every `/skill` a user types in one message.
//
// When you type `/skill-1 /skill-2 do XYZ`, only `/skill-1` (the leading token)
// is parsed as a command; the rest becomes its args. CC records that turn's
// user message as a skill-format string built by `_cl`:
//
//     <command-message>skill-1</command-message>
//     <command-name>/skill-1</command-name>
//     <command-args>/skill-2 do XYZ</command-args>
//
// The gate that decides whether a `disable-model-invocation` skill may run when
// the model calls the Skill tool is `Ocl`. It tests `(?<!\S)/<name>(?=$|\s)`
// against the turn's user messages — but it SKIPS any message containing the
// `<command-message>` tag. So the typed `/skill-2` (sitting inside
// `<command-args>`) is invisible to it, the gate returns false, and the model
// gets: "Skill skill-2 cannot be used with Skill tool due to
// disable-model-invocation". Result: only skill-1 ever runs.
//
// Verified live on 2.1.195: forcing the model to call Skill(skill-2) under a
// leading `/skill-1` hard-blocks with that exact error; the same `/skill-2` in a
// plain (non-skill-format) message is permitted and runs. So the cause is the
// wholesale skip, not model behavior. Once the gate can see the second `/name`,
// the model invokes the extra skills on its own (no prompt nudge needed).
//
// The fix: instead of skipping skill-format messages outright, extract their
// `<command-args>…</command-args>` content — which is exactly the text the user
// typed after the leading command — and run the same `/name` test against it.
// Everything else in `Ocl` is left untouched, so a `/name` the user did NOT type
// still can't satisfy the gate.
//
// Self-conditioning: `Ocl` is an idempotent permission check, not an invoker. If
// a future CC makes the second `/name` visible some other way (e.g. records the
// raw input as a plain message), our extra scan returns true in the same cases
// the native code already does — no double-invocation, no harm. When CC isn't
// affected, the branch is simply never entered.
//
// Stock `Ocl` (2.1.195), names churn but the shape is stable:
//
//     function Ocl(e,t){if(t.agentId!==void 0)return!1;let n=new RegExp(`(?<!\\S)/${xk(e)}(?=$|\\s)`);for(let r=t.messages.length-1;r>=t.turnStartIndex;r--){let o=t.messages[r];if(o.type!=="user"||o.isMeta)continue;let s=o.message.content;if(typeof s==="string"){if(s.includes(`<${zw}>`))continue}else if(s.some((i)=>i.type==="tool_result"))continue;if(n.test(NM(o)??""))return!0}return!1}

import { debug } from '../utils';
import { showDiff } from './index';

export const writeMultiSkillInvocation = (oldFile: string): string | null => {
  // Idempotency: our injected local is uniquely named.
  if (oldFile.includes('__tcMsiArgs')) {
    debug('patch: multiSkillInvocation: already patched — skipping');
    return oldFile;
  }

  // Match the gate `Ocl`, anchored on its unique `(?<!\S)/…(?=$|\s)` RegExp and
  // the `typeof <s>==="string"` skip of skill-format messages. Captures:
  //   1: the full `let <n>=new RegExp(`…`);` declaration (re-emitted as-is)
  //   2: the regex var <n>
  //   3: the loop preamble up to `let <s>=…content;` (re-emitted as-is)
  //   4: `if(typeof <s>==="string"){if(<s>.includes(`<…>`))` (re-emitted as-is)
  //   5: the message-content var <s>
  const pattern =
    /(let ([$\w]+)=new RegExp\(`[^`]*`\);)([\s\S]{0,400}?)(if\(typeof ([$\w]+)==="string"\)\{if\(\5\.includes\(`[^`]*`\)\))continue\}/;
  const match = oldFile.match(pattern);

  if (!match || match.index === undefined) {
    console.error(
      'patch: multiSkillInvocation: failed to find the skill-invocation gate (Ocl)'
    );
    return null;
  }

  const [fullMatch, regexDecl, regexVar, preamble, skipHead, contentVar] =
    match;

  // Replace the bare `continue}` skip with: scan the user-typed args carried in
  // `<command-args>…</command-args>` and permit if the `/name` test matches.
  const replacement =
    regexDecl +
    preamble +
    skipHead +
    `{let __tcMsiArgs=${contentVar}.match(/<command-args>([\\s\\S]*?)<\\/command-args>/);if(__tcMsiArgs&&${regexVar}.test(__tcMsiArgs[1]))return!0;continue}}`;

  const newFile =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + fullMatch.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    match.index,
    match.index + fullMatch.length
  );

  return newFile;
};
