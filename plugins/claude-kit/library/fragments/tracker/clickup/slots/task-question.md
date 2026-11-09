---
name: task-question
description: Prepare a question for a ClickUp task in the voice of whoever runs it — learned from that person's own past ClickUp comments — @-addressed to the person who has to answer, with the context that makes it answerable. Reads the issue and its thread, drops anything the code or the thread already answers, prints the question and stops. It posts only if the user then replies "post". Use when the user says "/task-question", "prepare a question for task 86abc12", "ask on the ticket", "what should I ask the PO".
argument-hint: "<task-id> <what you need to know> [reply:<commentId>]"
---

# /task-question — prepare a question for a task, in your own voice

The job is to **prepare a question** and hand it back. The default is to print it
and stop. Posting to ClickUp is a separate option that the user has to choose
explicitly. It never happens as part of the run.

A task comment is read by the people who decide, often the client. It must read
as if the person whose account posts it typed it by hand: their language, their
length, their habits. It must not read as a report.

## Step 1 — Parse the arguments

- The task id is required. If it is missing, ask for it.
- The rest is what you need to know. It can be a rough note in any language, or "the
  open points from what we just did". In that case, take them from this
  conversation.
- `reply:<commentId>` is used only if the user later picks **post**.

## Step 2 — Load the author's voice

Get the current user's id and name from the ClickUp MCP (`clickup_get_user`). The
voice lives in `skills/task-question/voices/<userId>.md`.

**If that file does not exist, build it once.** Do this read-only:

1. Find tasks the user worked on recently: `clickup_filter_tasks` /
   `clickup_search` for tasks they are assigned to or created, updated in the
   last year, up to 250.
2. List each task's comments (`clickup_get_task_comments`, plus
   `clickup_get_threaded_comments` for replies) and keep only those whose author is the user. Do
   this in a subagent, so the comment dumps stay out of the main context.
3. **Split them.** Keep the comments the person wrote by hand. Drop the generated
   ones: long "Open Questions" blocks, report-style analyses with headings,
   tables or code. Those are not their voice.
4. Write the voice file:
   - **Language and register.** Which language they write in, and how they
     write the domain and code words.
   - **Habits.** How they open (an @mention first? a greeting?), how they give
     context, how they number questions, whether names go in backticks, their
     punctuation, how long their comments usually are, and the phrases they reuse.
   - **How they ask for a decision with several options**, if they ever do.
   - **15–30 example comments, word for word**, grouped by kind (one-line
     question, context then question, several numbered questions, a decision
     with options). Fix obvious typos only. Redact anything that looks like a
     token or a password.
   - The date it was built and the number of comments it was built from.
5. Tell the user the file was created and how many comments it was built from.

If other files in `voices/` exist, read them too. The patterns that every author
shares are the team's conventions and apply to everyone. Personal habits apply
only to their owner.

Rebuild the file only when the user asks, or when it is more than six months old.

## Step 3 — Read the task and its thread

Read-only:

- The task: name, description, creator, assignees.
- The latest comments, newest first. Do not ask again what the thread already
  answers. Quote the answer back instead.

**Choose who to address.** Use the person who can decide, usually the task's creator.
Address more than one person only when more than one has to answer. Resolve every
@mention to a real user id (`clickup_find_member_by_name`). Never guess one.

## Step 4 — Make sure it really is a question

- A question that research can answer is not a question. Check the code on the
  base branch (fetch first, because the local tree is often behind) or the data.
  Then drop the question, or turn the finding into a context line in front of a
  sharper question.
- Any fact you state as context must be verified the same way. If you cannot
  verify it, write it as a guess, the way the author does.
- Only business, scope and ownership decisions stay as questions.

## Step 5 — Draft it in the author's voice

Follow the voice file. On top of it:

- **Context first, briefly.** Say what is there now or what was found, with
  concrete ids. Then the question.
- **Put the likely answer or the options inside the question**, so the reader can
  reply with one word.
- If the fix is known and only a yes is needed, ask for the yes.
- **Never** use emoji, a sign-off, a closing summary or "Open Questions" headings.
  Never mention the AI, a skill, a command, `.claude/`, plans, branches or PRs.

## Step 6 — Print it and stop

```
<task-id> → @<addressee>

<question text>
```

End the turn with:

```
Reply: **post** to put it on the task · **edit: <what to change>** · or copy it yourself
```

**The run ends here.** Do not call any ClickUp write tool in this turn.

## Step 7 — Option: post it (only on request)

Post only when the user's next message is an explicit **post**. An edit request,
an ambiguous reply or no reply is not a yes. An edit gets a new draft and goes back
to Step 6.

Post with `clickup_create_task_comment` (or as a reply in the thread for
`reply:`), using the user-mention form that tool documents so the mentions notify.
Then print the comment id and the task URL, and nothing else.

This skill never edits or deletes an existing comment, and never transitions,
assigns or edits the task.
