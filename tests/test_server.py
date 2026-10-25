import json
from pathlib import Path
import tempfile
import unittest
import uuid
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class PersistenceAndSelection(unittest.TestCase):
    def setUp(self):
        folder = Path(__file__).resolve().parents[1] / 'test-results'
        folder.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=folder)
        self.old_data, self.old_db = server.DATA, server.DB
        server.DATA = Path(self.tmp.name)
        server.DB = server.DATA / 'practice.sqlite3'
        server.init_db()

    def tearDown(self):
        server.DATA, server.DB = self.old_data, self.old_db
        self.tmp.cleanup()

    def test_bank_structure_and_branching(self):
        bank = server.BANK['topics']
        self.assertEqual(sum(t['part'] == 1 for t in bank), 39)
        self.assertEqual(sum(t['part'] == 2 for t in bank), 63)
        work = next(t for t in bank if t['title'] == 'Work or studies')
        self.assertEqual(len(server.eligible_questions(work, {'identity': 'student'})), 12)
        self.assertEqual(len(server.eligible_questions(work, {'identity': 'worker'})), 10)

    def test_unseen_card_is_selected_before_every_used_card(self):
        cards = [t for t in server.BANK['topics'] if t['part'] == 2 and t['region'] == 'mainland']
        target = cards[-1]
        counts = {t['id']: {'count': 1, 'last': 10} for t in cards[:-1]}
        for _ in range(20):
            self.assertEqual(server.choose_plan({'region': 'mainland'}, counts)['part2']['id'], target['id'])

    def test_plan_does_not_mark_anything_asked(self):
        server.choose_plan({'mode': 'full'})
        self.assertEqual(server.usage(), {})

    def test_only_displayed_questions_count_and_saves_are_idempotent(self):
        topic = next(t for t in server.BANK['topics'] if t['part'] == 1)
        qid = topic['questions'][0]['id']
        session = {'id': str(uuid.uuid4()), 'mode': 'topic', 'started': 1, 'events': [{'questionId': qid, 'askedAt': 2, 'answered': True}, {'questionId': 'intro-0', 'askedAt': 1}]}
        server.save_session(session)
        server.save_session(session)
        self.assertEqual(server.usage(), {qid: {'count': 1, 'last': 2}})
        session['id'] = str(uuid.uuid4())
        server.save_session(session)
        self.assertEqual(server.usage()[qid]['count'], 2)

    def test_selected_topic_mode_and_region(self):
        topic = next(t for t in server.BANK['topics'] if t['part'] == 2 and t['region'] == 'overseas')
        result = server.choose_plan({'mode': 'topic', 'topicId': topic['id'], 'region': 'all'})
        self.assertEqual(result['part1'], [])
        self.assertEqual(result['part2']['id'], topic['id'])
        for _ in range(10):
            result = server.choose_plan({'region': 'mainland'})
            self.assertTrue(all(t['region'] == 'mainland' for t in result['part1']))
            self.assertEqual(result['part2']['region'], 'mainland')

    def test_discard_removes_only_this_session_and_blocks_delayed_autosaves(self):
        topic = next(t for t in server.BANK['topics'] if t['part'] == 1)
        qid = topic['questions'][0]['id']
        first = {'id': str(uuid.uuid4()), 'mode': 'topic', 'events': [{'questionId': qid, 'askedAt': 2, 'answered': True}]}
        other = {'id': str(uuid.uuid4()), 'mode': 'topic', 'events': [{'questionId': qid, 'askedAt': 3, 'answered': True}]}
        server.save_session(first); server.save_session(other)
        folder = server.DATA / 'recordings' / first['id']
        folder.mkdir(); (folder / 'answer.webm').write_bytes(b'test recording')
        server.discard_session(first['id'])
        self.assertFalse(folder.exists())
        self.assertEqual(server.usage()[qid]['count'], 1)
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT id FROM sessions').fetchone()[0], other['id'])
        with self.assertRaisesRegex(ValueError, 'discarded'):
            server.save_session(first)
        server.discard_session(first['id'])  # Safe to retry after an interrupted response.
        with self.assertRaises(ValueError):
            server.discard_session('../outside')

    def test_practice_and_exam_are_separate_from_topic_scope(self):
        self.assertEqual(server.choose_plan({'mode': 'full', 'type': 'practice'})['type'], 'practice')
        self.assertEqual(server.choose_plan({'mode': 'full', 'type': 'exam'})['type'], 'exam')
        self.assertEqual(server.choose_plan({'mode': 'topic'})['type'], 'practice')

    def test_single_practice_does_not_change_exam_selection_or_draw_counts(self):
        import random
        random.seed(123)
        before = server.choose_plan({'mode': 'full'})
        qid = before['part1'][0]['questions'][0]['id']
        server.save_session({'id': str(uuid.uuid4()), 'mode': 'topic', 'events': [{'questionId': qid, 'answered': True}]})
        self.assertIn(qid, server.usage())
        self.assertEqual(server.exam_metrics(), {})
        random.seed(123)
        after = server.choose_plan({'mode': 'full'})
        self.assertEqual([t['id'] for t in before['part1']], [t['id'] for t in after['part1']])
        self.assertEqual(before['part2']['id'], after['part2']['id'])

    def test_selected_but_unfinished_exam_is_drawn_only_and_next_plan_rotates(self):
        plan = server.choose_plan({'mode': 'full'})
        selected = [q['id'] for t in plan['part1'][:3] for q in t['questions']] + [plan['part2']['id']]
        session = {'id': str(uuid.uuid4()), 'mode': 'full', 'status': 'interrupted', 'selection': selected, 'events': []}
        server.save_session(session)
        self.assertEqual(server.usage(), {})
        self.assertTrue(all(item['drawn'] == 1 and item['completed'] == 0 for item in server.exam_metrics().values()))
        next_plan = server.choose_plan({'mode': 'full'})
        self.assertTrue(set(t['id'] for t in plan['part1'][:3]).isdisjoint(t['id'] for t in next_plan['part1'][:3]))
        self.assertNotEqual(plan['part2']['id'], next_plan['part2']['id'])
        server.discard_session(session['id'])
        self.assertEqual(server.exam_metrics(), {})

    def test_only_whole_exam_completion_marks_actual_exam_answers_practiced(self):
        topic = next(t for t in server.BANK['topics'] if t['part'] == 1)
        first, second = [q['id'] for q in topic['questions'][:2]]
        session = {'id': str(uuid.uuid4()), 'mode': 'full', 'status': 'in_progress', 'selection': [first, second],
                   'events': [{'questionId': first, 'answered': True}]}
        server.save_session(session)
        self.assertEqual(server.exam_metrics()[first]['completed'], 0)
        session['status'] = 'completed'
        server.save_session(session); server.save_session(session)
        self.assertEqual(server.exam_metrics()[first]['completed'], 1)
        self.assertEqual(server.exam_metrics()[second]['completed'], 0)
        self.assertEqual(server.usage(), {})
        self.assertEqual(server.exam_metrics('topic_id')[topic['id']]['completed'], 1)

    def test_migration_rebuilds_scopes_without_changing_saved_history(self):
        qid = next(t for t in server.BANK['topics'] if t['part'] == 1)['questions'][0]['id']
        single = {'id': str(uuid.uuid4()), 'mode': 'topic', 'events': [{'questionId': qid, 'answered': True}]}
        full = {'id': str(uuid.uuid4()), 'mode': 'full', 'status': 'completed', 'events': [{'questionId': qid, 'answered': True}]}
        server.save_session(single); server.save_session(full)
        with server.connect() as db:
            db.execute('DELETE FROM single_practice'); db.execute('DELETE FROM exam_draws'); db.execute('DELETE FROM exam_completed')
        server.init_db(); server.init_db()
        self.assertEqual(server.usage()[qid]['count'], 1)
        self.assertEqual(server.exam_metrics()[qid]['completed'], 1)
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 2)

    def test_single_card_is_not_practiced_just_by_reading_the_preparation_card(self):
        topic = next(t for t in server.BANK['topics'] if t['part'] == 2)
        session = {'id': str(uuid.uuid4()), 'mode': 'topic', 'events': [{'questionId': topic['id'], 'stage': 'prep', 'answered': True}]}
        server.save_session(session); self.assertEqual(server.usage(), {})
        session['events'].append({'questionId': 'talk', 'stage': 'talk', 'answered': True})
        server.save_session(session); self.assertEqual(server.usage()[topic['id']]['count'], 1)


if __name__ == '__main__':
    unittest.main()
