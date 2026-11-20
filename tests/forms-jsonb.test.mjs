import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

test("jsonValue reads arrays, objects and older double-encoded strings", async () => {
	const { jsonValue } = await import("../packages/school/src/docs-forms.ts");
	const questions = [{ id: "q1", label: "Permission", type: "yesno", required: true }];
	assert.deepEqual(jsonValue(questions, []), questions);
	assert.deepEqual(jsonValue(JSON.stringify(questions), []), questions);
	assert.deepEqual(jsonValue(JSON.stringify(JSON.stringify(questions)), []), questions);
	assert.deepEqual(jsonValue(JSON.stringify({ q1: "yes" }), {}), { q1: "yes" });
	assert.deepEqual(jsonValue(null, []), []);
	assert.deepEqual(jsonValue("not json", []), []);
	assert.deepEqual(jsonValue({ a: 1 }, []), []);
});

test("saved forms keep questions and answers as jsonb arrays/objects", async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip("DATABASE_URL is not set");
		return;
	}
	const { db, dbReady, saveSchoolForm, guardianForms, saveAssignment } = await import("@tca/school");
	await dbReady();
	const familyId = randomUUID();
	const studentId = randomUUID();
	await db()`insert into families (id, name, email, phone, password_hash, roles) values (${familyId}, ${"Form Family"}, ${`form-${Date.now()}@example.com`}, ${""}, ${"hash"}, ${["guardian"]})`;
	await db()`insert into children (id, family_id, kind, name, grade) values (${studentId}, ${familyId}, 'student', ${"Kid Example"}, ${"3"})`;
	const questionId = randomUUID();
	const saved = await saveSchoolForm({ title: `Form ${Date.now()}`, instructions: "", audience: "everyone", grade: "", dueOn: "2027-01-31", questions: [{ id: questionId, label: "Permission", type: "yesno", required: true }], publish: true });
	assert.equal(saved.ok, true);
	const [stored] = await db()`select jsonb_typeof(questions) as t from school_forms where id = ${saved.id}`;
	assert.equal(stored.t, "array");
	const forms = await guardianForms(familyId);
	const mine = forms.find((item) => item.questions?.some((q) => q.id === questionId));
	assert.ok(mine, "guardian sees the form with its questions");
	const result = await saveAssignment({ familyId, id: mine.id, answers: { [questionId]: "yes" }, signature: "Form Family", confirm: true, submit: true });
	assert.equal(result.ok, true);
	const [answers] = await db()`select jsonb_typeof(answers) as t from form_assignments where id = ${mine.id}`;
	assert.equal(answers.t, "object");
});
