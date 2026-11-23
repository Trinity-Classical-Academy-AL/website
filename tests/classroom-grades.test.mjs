import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseGrade, gradingFor, letterFor } from '../packages/school/src/classroom.ts';

test('letters follow the usual 10-point scale with plus and minus', () => {
	assert.equal(letterFor(95), 'A'); assert.equal(letterFor(91), 'A-'); assert.equal(letterFor(88), 'B+'); assert.equal(letterFor(72.9), 'C-'); assert.equal(letterFor(59), 'F');
	assert.equal(gradingFor('K'), 'mark'); assert.equal(gradingFor('2'), 'mark'); assert.equal(gradingFor('3'), 'letter');
});

test('weighted categories, ignoring empty categories and excused work', () => {
	const assignments = [
		{ id: 't1', category: 'Tests', points: 100, graded: true },
		{ id: 'h1', category: 'Homework', points: 10, graded: true },
		{ id: 'h2', category: 'Homework', points: 10, graded: true },
		{ id: 'n', category: 'Homework', points: null, graded: false },
	];
	const scores = new Map([['t1', { points: 80, mark: '', excused: false }], ['h1', { points: 10, mark: '', excused: false }], ['h2', { points: 0, mark: '', excused: true }]]);
	// Tests 80% (weight 40) and Homework 100% (weight 20); Quizzes/Projects have nothing graded.
	const grade = courseGrade({ grading: 'letter', weights: { Tests: 40, Quizzes: 25, Homework: 20, Projects: 15 }, assignments, scores });
	assert.equal(grade.percent, 86.7);
	assert.equal(grade.display, 'B (86.7%)');
});

test('K–2 marks: the most common mark, ties go to the lower mark', () => {
	const assignments = ['a', 'b', 'c', 'd'].map((id) => ({ id, category: 'Homework', points: null, graded: true }));
	const scores = new Map([['a', { points: null, mark: 'E', excused: false }], ['b', { points: null, mark: 'S', excused: false }], ['c', { points: null, mark: 'E', excused: false }], ['d', { points: null, mark: 'S', excused: false }]]);
	assert.equal(courseGrade({ grading: 'mark', weights: {}, assignments, scores }).display, 'S');
});
