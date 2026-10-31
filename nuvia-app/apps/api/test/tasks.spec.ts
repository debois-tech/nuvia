import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemindersService } from '../src/tasks/reminders.service';
import { Harness } from './harness';

const DAY = 86_400_000;

describe('projects, tasks, comments, attachments and notifications', () => {
  let h: Harness;
  let uploadDir: string;
  let ids: Record<string, string>;
  let t: Record<string, string>;
  let projectId: string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'nuvia-uploads-'));
    h = await Harness.create({ uploadDir, maxUploadBytes: 1024 });
  });
  afterAll(async () => {
    await h.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await h.reset();
    ids = await h.createUsers(
      { orgId: 'EXEC', role: 'executive' },
      { orgId: 'HR', role: 'hr_admin' },
      { orgId: 'LEAD', role: 'team_lead' },
      { orgId: 'OTHERLEAD', role: 'team_lead' },
      { orgId: 'ANN', name: 'Ann' },
      { orgId: 'BOB', name: 'Bob' },
      { orgId: 'OUTSIDER' },
    );
    t = {};
    for (const o of Object.keys(ids)) t[o] = await h.login(o);
    projectId = (await h.as(t.LEAD).post('/projects', { key: 'web', name: 'Website' }).expect(201)).body.id;
    for (const u of ['ANN', 'BOB']) await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids[u] }).expect(201);
  });

  const mk = async (over: Record<string, unknown> = {}, as = 'LEAD') =>
    (await h.as(t[as]).post('/tasks', { projectId, title: 'Write copy', ...over }).expect(201)).body;
  const notes = async (who: string) => (await h.as(t[who]).get('/notifications').expect(200)).body as { unread: number; items: { kind: string; message: string; taskId: string | null }[] };

  describe('projects and access', () => {
    it('creates a project with the creator as lead and an upper-cased key', async () => {
      const p = (await h.as(t.LEAD).get(`/projects/${projectId}`).expect(200)).body;
      expect(p.key).toBe('WEB');
      expect(p.members.map((m: any) => [m.orgId, m.role])).toEqual(expect.arrayContaining([['LEAD', 'lead'], ['ANN', 'member']]));
      expect(p.access.manage).toBe(true);
    });

    it('rejects duplicate and malformed keys, and employees creating projects', async () => {
      await h.as(t.LEAD).post('/projects', { key: 'WEB', name: 'Again' }).expect(409);
      await h.as(t.LEAD).post('/projects', { key: '1x', name: 'Bad' }).expect(400);
      await h.as(t.ANN).post('/projects', { key: 'ANNP', name: 'Mine' }).expect(403);
      await h.as(t.EXEC).post('/projects', { key: 'EXP', name: 'Mine' }).expect(403);
    });

    it('shows a project only to its members, HR and executives', async () => {
      const ids2 = (u: string) => h.as(t[u]).get('/projects').expect(200).then((r) => r.body.map((p: any) => p.key));
      expect(await ids2('ANN')).toEqual(['WEB']);
      expect(await ids2('OUTSIDER')).toEqual([]);
      expect(await ids2('OTHERLEAD')).toEqual([]);
      expect(await ids2('HR')).toEqual(['WEB']);
      expect(await ids2('EXEC')).toEqual(['WEB']);
      // A hidden project looks like a missing one.
      await h.as(t.OUTSIDER).get(`/projects/${projectId}`).expect(404);
    });

    it("hides another lead's project and its tasks, even from a team lead", async () => {
      const task = await mk();
      await h.as(t.OTHERLEAD).get(`/projects/${projectId}`).expect(404);
      await h.as(t.OTHERLEAD).get(`/tasks/${task.id}`).expect(404);
      await h.as(t.OTHERLEAD).patch(`/tasks/${task.id}`, { title: 'x' }).expect(404);
      await h.as(t.OTHERLEAD).post('/tasks', { projectId, title: 'x' }).expect(404);
      expect((await h.as(t.OTHERLEAD).get('/tasks').expect(200)).body).toEqual([]);
    });

    it('only the project lead (or HR) manages members, and leads must hold a managing role', async () => {
      await h.as(t.ANN).post(`/projects/${projectId}/members`, { userId: ids.OUTSIDER }).expect(403);
      await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids.OUTSIDER, role: 'lead' }).expect(400);
      await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids.EXEC }).expect(400);
      await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids.OTHERLEAD, role: 'lead' }).expect(201);
      await h.as(t.OTHERLEAD).get(`/projects/${projectId}`).expect(200);
    });

    it('a team lead who is only a plain member cannot manage', async () => {
      await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids.OTHERLEAD, role: 'member' }).expect(201);
      await h.as(t.OTHERLEAD).post('/tasks', { projectId, title: 'x' }).expect(403);
    });

    it('lists the directory for leads and HR only', async () => {
      expect((await h.as(t.LEAD).get('/projects/directory').expect(200)).body.length).toBeGreaterThan(3);
      await h.as(t.ANN).get('/projects/directory').expect(403);
    });

    it('will not remove a member with open tasks, or the last lead', async () => {
      await mk({ assigneeId: ids.ANN });
      await h.as(t.LEAD).delete(`/projects/${projectId}/members/${ids.ANN}`).expect(409);
      await h.as(t.LEAD).delete(`/projects/${projectId}/members/${ids.LEAD}`).expect(409);
      await h.as(t.LEAD).delete(`/projects/${projectId}/members/${ids.BOB}`).expect(200);
    });

    it('archived projects are read-only and hidden from the default list', async () => {
      const task = await mk();
      await h.as(t.LEAD).patch(`/projects/${projectId}`, { archived: true }).expect(200);
      expect((await h.as(t.LEAD).get('/projects').expect(200)).body).toHaveLength(0);
      expect((await h.as(t.LEAD).get('/projects?archived=1').expect(200)).body).toHaveLength(1);
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'late' }).expect(409);
      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { title: 'late' }).expect(409);
      await h.as(t.ANN).post(`/tasks/${task.id}/comments`, { body: 'hi' }).expect(409);
      await h.as(t.LEAD).patch(`/projects/${projectId}`, { archived: false }).expect(200);
      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { title: 'back' }).expect(200);
    });
  });

  describe('tasks', () => {
    it('numbers tasks per project and keeps numbers unique under concurrency', async () => {
      const made = await Promise.all(Array.from({ length: 8 }, (_, i) => mk({ title: `T${i}` })));
      expect(new Set(made.map((m) => m.number)).size).toBe(8);
      expect(Math.min(...made.map((m) => m.number))).toBe(1);
      expect(made[0].projectKey).toBe('WEB');
    });

    it('creates with assignee, priority, due date and records history', async () => {
      const task = await mk({ assigneeId: ids.ANN, priority: 'high', dueDate: '2026-03-10' });
      expect(task).toMatchObject({ status: 'todo', priority: 'high', dueDate: '2026-03-10', assignee: { orgId: 'ANN' }, reporter: { orgId: 'LEAD' } });
      expect(task.activity[0].kind).toBe('created');
    });

    it('validates input', async () => {
      await h.as(t.LEAD).post('/tasks', { projectId, title: '   ' }).expect(400);
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'x', dueDate: '2026-02-31' }).expect(400);
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'x', priority: 'asap' }).expect(400);
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'x', surprise: 1 }).expect(400);
      await h.as(t.LEAD).patch(`/tasks/${(await mk()).id}`, {}).expect(400);
    });

    it('only assigns to active members of the project', async () => {
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'x', assigneeId: ids.OUTSIDER }).expect(400);
      const task = await mk();
      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { assigneeId: ids.OUTSIDER }).expect(400);
      await h.db.query('UPDATE users SET active = false WHERE id = $1', [ids.BOB]);
      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { assigneeId: ids.BOB }).expect(400);
    });

    it('sub-tasks stay in the project and cannot nest', async () => {
      const parent = await mk({ title: 'Parent' });
      const child = await mk({ title: 'Child', parentId: parent.id });
      expect(child.parent).toMatchObject({ number: parent.number });
      await h.as(t.LEAD).post('/tasks', { projectId, title: 'Grandchild', parentId: child.id }).expect(400);
      const other = (await h.as(t.HR).post('/projects', { key: 'OPS', name: 'Ops' }).expect(201)).body.id;
      await h.as(t.HR).post('/tasks', { projectId: other, title: 'Cross', parentId: parent.id }).expect(400);
      expect((await h.as(t.LEAD).get(`/tasks/${parent.id}`)).body.subtasks).toHaveLength(1);
    });

    it('employees move only their own tasks and edit nothing else', async () => {
      const mine = await mk({ assigneeId: ids.ANN });
      const bobs = await mk({ assigneeId: ids.BOB });
      const r = await h.as(t.ANN).patch(`/tasks/${mine.id}`, { status: 'in_progress' }).expect(200);
      expect(r.body.status).toBe('in_progress');
      await h.as(t.ANN).patch(`/tasks/${bobs.id}`, { status: 'in_progress' }).expect(403);
      await h.as(t.ANN).patch(`/tasks/${mine.id}`, { title: 'renamed' }).expect(403);
      await h.as(t.ANN).patch(`/tasks/${mine.id}`, { status: 'done', assigneeId: ids.BOB }).expect(403);
      await h.as(t.ANN).patch(`/tasks/${mine.id}`, { dueDate: '2030-01-01' }).expect(403);
      await h.as(t.ANN).post('/tasks', { projectId, title: 'x' }).expect(403);
      // ...but they can see the rest of their project.
      expect((await h.as(t.ANN).get(`/tasks/${bobs.id}`).expect(200)).body.can).toMatchObject({ edit: false, changeStatus: false, comment: true });
    });

    it('executives read everything and change nothing', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      expect((await h.as(t.EXEC).get('/tasks').expect(200)).body).toHaveLength(1);
      expect((await h.as(t.EXEC).get(`/tasks/${task.id}`).expect(200)).body.can).toMatchObject({ edit: false, changeStatus: false, comment: false, attach: false });
      await h.as(t.EXEC).patch(`/tasks/${task.id}`, { status: 'done' }).expect(403);
      await h.as(t.EXEC).post(`/tasks/${task.id}/comments`, { body: 'hello' }).expect(403);
      await h.as(t.EXEC).upload(`/tasks/${task.id}/attachments?name=a.txt`, 'abc').expect(403);
      await h.as(t.EXEC).post('/tasks', { projectId, title: 'x' }).expect(403);
    });

    it('HR can fix any task', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      expect((await h.as(t.HR).get('/tasks').expect(200)).body).toHaveLength(1);
      expect((await h.as(t.HR).get('/tasks?assignee=me').expect(200)).body).toHaveLength(0);
      await h.as(t.HR).patch(`/tasks/${task.id}`, { assigneeId: ids.BOB, priority: 'urgent' }).expect(200);
    });

    it('sets and clears completed_at as status changes, and logs each change', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      let r = (await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'done' }).expect(200)).body;
      expect(r.completedAt).toBeTruthy();
      r = (await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'in_review' }).expect(200)).body;
      expect(r.completedAt).toBeNull();
      expect(r.activity.filter((a: any) => a.kind === 'status_changed').map((a: any) => a.detail.to)).toEqual(['done', 'in_review']);
      // No-op patch adds no history.
      const n = r.activity.length;
      expect((await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'in_review' }).expect(200)).body.activity).toHaveLength(n);
    });

    it('filters by project, assignee, status, due and text', async () => {
      await mk({ title: 'Alpha banner', assigneeId: ids.ANN, dueDate: '2026-03-01' }); // overdue (today is 2026-03-02)
      await mk({ title: 'Beta page', assigneeId: ids.ANN, dueDate: '2026-03-03', priority: 'urgent' }); // due soon
      await mk({ title: 'Gamma 100%', assigneeId: ids.BOB });
      await mk({ title: 'Delta' });
      const get = async (q: string) => (await h.as(t.LEAD).get(`/tasks${q}`).expect(200)).body.map((x: any) => x.title);
      expect(await get('')).toHaveLength(4);
      expect((await get('?assignee=none'))).toEqual(['Delta']);
      expect((await get(`?assignee=${ids.BOB}`))).toEqual(['Gamma 100%']);
      expect((await get('?due=overdue'))).toEqual(['Alpha banner']);
      expect((await get('?due=soon'))).toEqual(['Beta page']);
      expect((await get('?q=alpha'))).toEqual(['Alpha banner']);
      expect((await get('?q=100%25'))).toEqual(['Gamma 100%']); // % is matched literally
      expect((await get('?q=WEB-1'))).toEqual(expect.arrayContaining(['Alpha banner']));
      expect(await get('?status=done')).toEqual([]);
      expect((await h.as(t.ANN).get('/tasks?assignee=me').expect(200)).body).toHaveLength(2);
      await h.as(t.LEAD).get('/tasks?status=bogus').expect(400);
      // Most urgent first.
      expect((await get(''))[0]).toBe('Beta page');
    });

    it('marks overdue tasks, but never a finished one', async () => {
      const task = await mk({ assigneeId: ids.ANN, dueDate: '2026-03-01' });
      expect((await h.as(t.LEAD).get(`/tasks/${task.id}`)).body.overdue).toBe(true);
      await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'done' }).expect(200);
      expect((await h.as(t.LEAD).get(`/tasks/${task.id}`)).body.overdue).toBe(false);
    });
  });

  describe('comments', () => {
    it('lets members comment and notifies the assignee and reporter, not the author', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      await h.as(t.BOB).post(`/tasks/${task.id}/comments`, { body: 'Looks good' }).expect(201);
      const ann = await notes('ANN');
      expect(ann.items.some((n) => n.kind === 'task_comment' && n.taskId === task.id)).toBe(true);
      expect((await notes('LEAD')).items.some((n) => n.kind === 'task_comment')).toBe(true);
      expect((await notes('BOB')).items.some((n) => n.kind === 'task_comment')).toBe(false);
      const view = (await h.as(t.LEAD).get(`/tasks/${task.id}`)).body;
      expect(view.comments).toMatchObject([{ body: 'Looks good', authorName: 'Bob' }]);
    });

    it('rejects empty comments and non-members', async () => {
      const task = await mk();
      await h.as(t.ANN).post(`/tasks/${task.id}/comments`, { body: '  ' }).expect(400);
      await h.as(t.OUTSIDER).post(`/tasks/${task.id}/comments`, { body: 'hi' }).expect(404);
    });

    it('stores comment text as plain text (the UI escapes it)', async () => {
      const task = await mk();
      await h.as(t.ANN).post(`/tasks/${task.id}/comments`, { body: '<img src=x onerror=alert(1)>' }).expect(201);
      expect((await h.as(t.ANN).get(`/tasks/${task.id}`)).body.comments[0].body).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('notifications', () => {
    it('notifies on assignment, reassignment, status and due-date changes, never the actor', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      expect((await notes('ANN')).items.map((n) => n.kind)).toEqual(['task_assigned']);
      expect((await notes('LEAD')).items).toHaveLength(0); // the creator isn't told about their own action

      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { assigneeId: ids.BOB }).expect(200);
      expect((await notes('BOB')).items.map((n) => n.kind)).toEqual(['task_assigned']);
      expect((await notes('ANN')).items.map((n) => n.kind)).toContain('task_unassigned');

      await h.as(t.BOB).patch(`/tasks/${task.id}`, { status: 'in_review' }).expect(200);
      const lead = await notes('LEAD');
      expect(lead.items[0]).toMatchObject({ kind: 'task_status', taskId: task.id });
      expect(lead.items[0].message).toContain('In review');

      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { dueDate: '2026-04-01' }).expect(200);
      expect((await notes('BOB')).items.map((n) => n.kind)).toContain('task_due_changed');
    });

    it('does not tell someone who was removed from the project', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'done' }).expect(200);
      await h.as(t.LEAD).delete(`/projects/${projectId}/members/${ids.ANN}`).expect(200); // allowed: no open tasks
      const before = (await notes('ANN')).items.length;
      await h.as(t.BOB).post(`/tasks/${task.id}/comments`, { body: 'Thanks Ann' }).expect(201); // would go to the assignee
      await h.as(t.LEAD).patch(`/tasks/${task.id}`, { status: 'todo' }).expect(200);
      expect((await notes('ANN')).items.length).toBe(before);
      await h.as(t.ANN).get(`/tasks/${task.id}`).expect(404);
    });

    it('marks them read, per person', async () => {
      await mk({ assigneeId: ids.ANN });
      const n = await notes('ANN');
      expect(n.unread).toBe(1);
      await h.as(t.BOB).post(`/notifications/${(n as any).items[0].id}/read`).expect(404); // not Bob's
      await h.as(t.ANN).post(`/notifications/${(n as any).items[0].id}/read`).expect(204);
      expect((await notes('ANN')).unread).toBe(0);
    });

    it('sends due-soon and overdue reminders once, and again after the date changes', async () => {
      const reminders = h.app.get(RemindersService);
      const soon = await mk({ title: 'Soon', assigneeId: ids.ANN, dueDate: '2026-03-02' }); // today
      const late = await mk({ title: 'Late', assigneeId: ids.BOB, dueDate: '2026-03-01' });
      await mk({ title: 'Far', assigneeId: ids.ANN, dueDate: '2026-06-01' });
      await mk({ title: 'Nobody', dueDate: '2026-03-01' });
      const done = await mk({ title: 'Done', assigneeId: ids.ANN, dueDate: '2026-03-01' });
      await h.as(t.ANN).patch(`/tasks/${done.id}`, { status: 'done' }).expect(200);

      expect(await reminders.tick(h.clock.now())).toBe(2);
      expect(await reminders.tick(h.clock.now())).toBe(0); // once
      const ann = (await notes('ANN')).items.filter((n) => n.kind === 'task_due_soon');
      expect(ann).toHaveLength(1);
      expect(ann[0].message).toContain('due today');
      expect((await notes('BOB')).items.filter((n) => n.kind === 'task_overdue')).toHaveLength(1);

      // Tomorrow the "soon" task is overdue and is reminded about that too.
      h.clock.advance(DAY);
      expect(await reminders.tick(h.clock.now())).toBeGreaterThanOrEqual(1);
      expect((await notes('ANN')).items.filter((n) => n.kind === 'task_overdue').map((n) => n.taskId)).toContain(soon.id);

      // Moving the date re-arms the reminders.
      await h.as(t.LEAD).patch(`/tasks/${late.id}`, { dueDate: '2026-03-03' }).expect(200);
      h.clock.advance(DAY);
      await reminders.tick(h.clock.now());
      expect((await notes('BOB')).items.filter((n) => n.kind === 'task_overdue')).toHaveLength(2);
    });

    it('sends no reminders for archived projects', async () => {
      await mk({ assigneeId: ids.ANN, dueDate: '2026-03-01' });
      await h.as(t.LEAD).patch(`/projects/${projectId}`, { archived: true }).expect(200);
      expect(await h.app.get(RemindersService).tick(h.clock.now())).toBe(0);
    });
  });

  describe('attachments', () => {
    const up = (who: string, taskId: string, body: Buffer | string, name = 'spec.txt') =>
      h.as(t[who]).upload(`/tasks/${taskId}/attachments?name=${encodeURIComponent(name)}&type=text%2Fplain`, body);

    it('stores a file on disk, lists it and returns the same bytes as a download', async () => {
      const task = await mk();
      const r = await up('ANN', task.id, 'hello attachment').expect(201);
      expect(r.body).toMatchObject({ fileName: 'spec.txt', contentType: 'text/plain', sizeBytes: 16 });
      const view = (await h.as(t.LEAD).get(`/tasks/${task.id}`)).body;
      expect(view.attachments).toMatchObject([{ fileName: 'spec.txt', uploaderName: 'Ann', canRemove: true }]);
      const dl = await h.as(t.BOB).get(`/tasks/attachments/${r.body.id}`).expect(200).buffer(true);
      expect(dl.text ?? dl.body.toString()).toBe('hello attachment');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-security-policy']).toContain('sandbox');
      // The stored name is a random key, not what the user typed.
      const { storageKey } = (await h.db.query('SELECT storage_key FROM task_attachments')).rows[0];
      expect(storageKey).not.toContain('spec');
      expect(existsSync(join(uploadDir, storageKey.slice(0, 2), storageKey))).toBe(true);
    });

    it('keeps binary content intact', async () => {
      const task = await mk();
      const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const r = await h.as(t.ANN).upload(`/tasks/${task.id}/attachments?name=b.bin`, bytes).expect(201);
      const dl = await h.as(t.ANN).get(`/tasks/attachments/${r.body.id}`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(Buffer.compare(dl.body, bytes)).toBe(0);
    });

    it('cleans path tricks out of file names', async () => {
      const task = await mk();
      const r = await up('ANN', task.id, 'x', '../../etc/pass"wd\r\n.txt').expect(201);
      expect(r.body.fileName).toBe('passwd.txt');
      expect((await up('ANN', task.id, 'x', '..\\..\\boot.ini').expect(201)).body.fileName).toBe('boot.ini');
    });

    it('serves HTML uploads as downloads with a neutral sandbox, never inline', async () => {
      const task = await mk();
      const r = await h.as(t.ANN).upload(`/tasks/${task.id}/attachments?name=x.html&type=text%2Fhtml`, '<script>alert(1)</script>').expect(201);
      const dl = await h.as(t.ANN).get(`/tasks/attachments/${r.body.id}`).expect(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-security-policy']).toMatch(/sandbox/);
    });

    it('rejects files over the limit without keeping any bytes', async () => {
      const task = await mk();
      await up('ANN', task.id, Buffer.alloc(2048, 1)).expect(413);
      await up('ANN', task.id, '').expect(400);
      expect((await h.db.query('SELECT count(*)::int AS n FROM task_attachments')).rows[0].n).toBe(0);
    });

    it('requires a raw octet-stream body', async () => {
      const task = await mk();
      await h.as(t.ANN).upload(`/tasks/${task.id}/attachments?name=a.json`, '{"a":1}', 'application/json').expect(415);
    });

    it('limits who can upload, download and delete', async () => {
      const task = await mk();
      await up('OUTSIDER', task.id, 'x').expect(404);
      const a = (await up('ANN', task.id, 'mine').expect(201)).body;
      await h.as(t.OUTSIDER).get(`/tasks/attachments/${a.id}`).expect(404);
      await h.as(t.OTHERLEAD).get(`/tasks/attachments/${a.id}`).expect(404);
      await h.as(t.EXEC).get(`/tasks/attachments/${a.id}`).expect(200); // read-only access
      await h.as(t.BOB).delete(`/tasks/attachments/${a.id}`).expect(403); // not theirs
      await h.as(t.OUTSIDER).delete(`/tasks/attachments/${a.id}`).expect(404);
      await h.as(t.ANN).delete(`/tasks/attachments/${a.id}`).expect(204);
      await h.as(t.ANN).get(`/tasks/attachments/${a.id}`).expect(404);
    });

    it('lets the project lead remove anyone’s file and deletes the bytes but keeps a record', async () => {
      const task = await mk();
      const a = (await up('ANN', task.id, 'mine').expect(201)).body;
      const { storageKey } = (await h.db.query('SELECT storage_key FROM task_attachments')).rows[0];
      await h.as(t.LEAD).delete(`/tasks/attachments/${a.id}`).expect(204);
      expect(existsSync(join(uploadDir, storageKey.slice(0, 2), storageKey))).toBe(false);
      expect((await h.db.query('SELECT deleted_at FROM task_attachments')).rows[0].deletedAt).toBeTruthy();
      const view = (await h.as(t.LEAD).get(`/tasks/${task.id}`)).body;
      expect(view.attachments).toHaveLength(0);
      expect(view.activity.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['attachment_added', 'attachment_removed']));
    });

    it('caps files per task', async () => {
      const task = await mk();
      for (let i = 0; i < 20; i++) await up('ANN', task.id, `f${i}`, `f${i}.txt`).expect(201);
      await up('ANN', task.id, 'one more').expect(409);
    });
  });

  describe('audit trail', () => {
    it('records who created, changed and downloaded', async () => {
      const task = await mk({ assigneeId: ids.ANN });
      await h.as(t.ANN).patch(`/tasks/${task.id}`, { status: 'done' }).expect(200);
      const a = (await h.as(t.ANN).upload(`/tasks/${task.id}/attachments?name=a.txt`, 'abc').expect(201)).body;
      await h.as(t.BOB).get(`/tasks/attachments/${a.id}`).expect(200);
      const rows = (await h.db.query('SELECT a.action, u.org_id FROM audit_log a JOIN users u ON u.id = a.actor_id ORDER BY a.id')).rows;
      expect(rows.map((r) => `${r.action}:${r.orgId}`)).toEqual(
        expect.arrayContaining(['project.create:LEAD', 'task.create:LEAD', 'task.update:ANN', 'attachment.upload:ANN', 'attachment.download:BOB']),
      );
    });
  });

  it('requires sign-in for every task endpoint', async () => {
    await h.http().get('/tasks').expect(401);
    await h.http().get('/projects').expect(401);
    await h.http().post('/tasks/00000000-0000-4000-8000-000000000000/attachments').send('x').expect(401);
  });
});
