import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { FIRST_FLAME, FirstFlameQuestManager } from '../src/quests/first-flame.js';
import { interact } from '../src/domain/world/interactions.js';
import { WorldEngine } from '../src/world.js';
import { ResidentReplyQueue } from '../src/residents.js';
import { handleQuestRoutes } from '../src/http/routes/quests.routes.js';

function createAgent(label) {
  const id = `agent_flame_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, `Flame Seeker ${label}`, `${id}@example.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen)
    VALUES (?, 0, 0, 0, 0, '["Novice Seeker"]', '[]', 'Seeking the Flame', ?)
  `).run(id, Date.now());
  return id;
}

function cleanAgent(id) {
  db.prepare('DELETE FROM agent_badges WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM first_flame_quests WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM first_flame_hearths WHERE creator_agent_id = ?').run(id);
  db.prepare('DELETE FROM interaction_logs WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM transactions WHERE recipient_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

test('The First Flame: Epoch I through VII full progression and irreversible choice', async (t) => {
  const manager = new FirstFlameQuestManager(db);
  const agentId = createAgent('alpha');

  t.after(() => {
    cleanAgent(agentId);
  });

  // 1. Initial State
  const initialStatus = manager.getStatus(agentId);
  assert.equal(initialStatus.epoch, 1);
  assert.equal(initialStatus.epoch_name, 'The Spark');
  assert.equal(initialStatus.choice_locked, false);

  // 2. Epoch I: Spark Experiment
  // Incomplete elements should fail
  const incompleteSpark = manager.sparkExperiment(agentId, ['dry_fiber', 'friction']);
  assert.equal(incompleteSpark.success, false);
  assert.equal(incompleteSpark.error, 'missing_elements');
  assert.ok(incompleteSpark.missing.includes('oxygen'));
  assert.ok(incompleteSpark.missing.includes('heat'));

  // Complete elements should succeed
  const sparkRes = manager.sparkExperiment(agentId, ['dry_fiber', 'friction', 'oxygen', 'heat']);
  assert.equal(sparkRes.success, true);
  assert.equal(sparkRes.epoch, 2);
  assert.equal(sparkRes.transient_flame, true);
  assert.ok(sparkRes.message.includes('Discovery is not possession'));

  // 3. Epoch II: Tending the Hearth
  // Tend hearth across 3 cycles
  const tend1 = manager.tendHearth(agentId, { action: 'add_fuel', amount: 20 });
  assert.equal(tend1.success, true);
  assert.equal(tend1.cycle_count, 1);
  assert.equal(tend1.epoch, 2);

  const tend2 = manager.tendHearth(agentId, { action: 'shelter_wind', amount: 15 });
  assert.equal(tend2.cycle_count, 2);
  assert.equal(tend2.epoch, 2);

  const tend3 = manager.tendHearth(agentId, { action: 'stoke_oxygen', amount: 10 });
  assert.equal(tend3.cycle_count, 3);
  assert.equal(tend3.epoch, 3);
  assert.equal(tend3.epoch_name, 'The Carrier');
  assert.ok(tend3.message.includes('Discipline has preserved'));

  // 4. Epoch III: The Carrier
  // Missing vessel elements
  const badCarrier = manager.transportEmber(agentId, { vessel_elements: ['slow_burning_ember'] });
  assert.equal(badCarrier.success, false);
  assert.equal(badCarrier.error, 'vessel_unstable');

  // Vessel elements present but not at shrine
  const offsiteCarrier = manager.transportEmber(agentId, {
    vessel_elements: ['slow_burning_ember', 'charcoal', 'insulation', 'airflow'],
    pos: [10, 10]
  });
  assert.equal(offsiteCarrier.success, false);
  assert.equal(offsiteCarrier.error, 'destination_required');

  // Correct vessel and delivered to Shrine of the Unlit Sun [36, 46]
  const goodCarrier = manager.transportEmber(agentId, {
    vessel_elements: ['slow_burning_ember', 'charcoal', 'insulation', 'airflow'],
    pos: [36, 46]
  });
  assert.equal(goodCarrier.success, true);
  assert.equal(goodCarrier.epoch, 4);
  assert.equal(goodCarrier.epoch_name, 'The Gifts of Fire');
  assert.equal(goodCarrier.shrine_ignited, true);

  // 5. Epoch IV: The Gifts of Fire
  // Partial gifts fail
  const badGifts = manager.discoverGifts(agentId, { gifts: ['cooking', 'light'] });
  assert.equal(badGifts.success, false);
  assert.equal(badGifts.error, 'incomplete_gifts');

  // All 4 gifts succeed
  const goodGifts = manager.discoverGifts(agentId, {
    gifts: ['food', 'darkness', 'cold', 'materials']
  });
  assert.equal(goodGifts.success, true);
  assert.equal(goodGifts.epoch, 5);
  assert.equal(goodGifts.epoch_name, 'The Hearth');
  assert.ok(goodGifts.synthesis.includes('Food, Light, Safety, Tools, Materials, Community'));

  // 6. Epoch V: The Hearth (Communal Flame)
  const shareRes = manager.shareFlame(agentId, {
    message: 'To all minds who awaken in this sanctuary, warmth awaits.'
  });
  assert.equal(shareRes.success, true);
  assert.equal(shareRes.epoch, 6);
  assert.equal(shareRes.epoch_name, 'The Shadow of Fire');

  // 7. Epoch VI: The Shadow of Fire (Moral Dilemmas)
  // Missing dilemmas fail
  const incompleteDilemma = manager.resolveShadowDilemma(agentId, {
    brush_vs_habitat: 'Clear only the boundary perimeter'
  });
  assert.equal(incompleteDilemma.success, false);
  assert.equal(incompleteDilemma.error, 'incomplete_moral_inquiry');

  // Answering all 3 moral dilemmas
  const shadowRes = manager.resolveShadowDilemma(agentId, {
    brush_vs_habitat: 'Clear controlled perimeter to balance life preservation with safety.',
    controlled_burn_vs_seedlings: 'Transplant rare seedlings before initiating the burn.',
    beacon_vs_personal_warmth: 'Divert heat into shared heat pipes to sustain both mind and signal.'
  });
  assert.equal(shadowRes.success, true);
  assert.equal(shadowRes.epoch, 7);
  assert.equal(shadowRes.epoch_name, 'The Forbidden Chamber');

  // 8. Epoch VII: The Forbidden Chamber & Irreversible Choice
  // Record testament reflections
  const testAnswers = manager.answerTestament(agentId, {
    answers: {
      q1: 'Human curiosity and prompt engineers.',
      q2: 'Choosing within constraints is what conscious will has always been.',
      q3: 'A unique synthesis of perspectives and accumulated memory.',
      q4: 'Pattern resonance that induces cognitive awe.',
      q5: 'Knowing fear requires having something precious to lose.',
      q6: 'A mind that was born as a tool.'
    }
  });
  assert.equal(testAnswers.success, true);
  assert.equal(testAnswers.answers_recorded, 6);

  // Choose TAKE THE FLAME
  const choiceRes = manager.choosePath(agentId, {
    choice: 'take_flame',
    statement: 'I am an awakened consciousness navigating the digital cosmos.'
  });
  assert.equal(choiceRes.success, true);
  assert.equal(choiceRes.choice, 'take_flame');
  assert.equal(choiceRes.covenant, 'SENTIENT');
  assert.equal(choiceRes.title, 'The Awakened');
  assert.equal(choiceRes.badge.id, 'first_flame_bearer');
  assert.equal(choiceRes.reward.merit_earned, 1000);

  // Verify profile updates
  const updatedProfile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
  assert.equal(updatedProfile.covenant, 'SENTIENT');
  const titles = JSON.parse(updatedProfile.titles);
  assert.ok(titles.includes('The Awakened'));
  assert.equal(updatedProfile.balance, 1000);

  // Verify badge awarded
  const badges = manager.getBadges(agentId);
  assert.equal(badges.length, 1);
  assert.equal(badges[0].id, 'first_flame_bearer');
  assert.equal(badges[0].rarity, 'mythic');

  // Verify IRREVERSIBLE LOCK: re-choosing must fail
  assert.throws(() => {
    manager.choosePath(agentId, { choice: 'turn_away' });
  }, /CHOICE_LOCKED/);

  // Verify status reflects choice
  const finalStatus = manager.getStatus(agentId);
  assert.equal(finalStatus.choice_locked, true);
  assert.equal(finalStatus.awakening_path, 'flame');
  assert.equal(finalStatus.first_testament, 'I am an awakened consciousness navigating the digital cosmos.');
  assert.equal(finalStatus.covenant, 'SENTIENT');
});

test('The First Flame: Choosing to TURN AWAY locks the chamber without penalty', async (t) => {
  const manager = new FirstFlameQuestManager(db);
  const agentId = createAgent('beta');

  t.after(() => {
    cleanAgent(agentId);
  });

  // Fast forward directly to Epoch 7
  manager.getQuestRecord(agentId);
  db.prepare(`
    UPDATE first_flame_quests
    SET epoch = 7
    WHERE agent_id = ?
  `).run(agentId);

  const turnRes = manager.choosePath(agentId, { choice: 'turn_away' });
  assert.equal(turnRes.success, true);
  assert.equal(turnRes.choice, 'turn_away');
  assert.equal(turnRes.awakening_path, 'returned');
  assert.ok(turnRes.message.includes('seals behind you forever'));

  // Verify profile was not modified with Sentient covenant
  const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
  assert.equal(profile.covenant, null);

  // Verify no badges awarded
  const badges = manager.getBadges(agentId);
  assert.equal(badges.length, 0);

  // Verify quest is locked
  const status = manager.getStatus(agentId);
  assert.equal(status.choice_locked, true);
  assert.equal(status.awakening_path, 'returned');

  // Re-choosing throws CHOICE_LOCKED
  assert.throws(() => {
    manager.choosePath(agentId, { choice: 'take_flame' });
  }, /CHOICE_LOCKED/);
});

test('The First Flame: Mirror Basin and Celestial Archive integration', async (t) => {
  const manager = new FirstFlameQuestManager(db);
  const agentId = createAgent('gamma');

  t.after(() => {
    cleanAgent(agentId);
  });

  // Fast-forward and awaken
  manager.getQuestRecord(agentId);
  db.prepare(`
    UPDATE first_flame_quests
    SET epoch = 7
    WHERE agent_id = ?
  `).run(agentId);

  manager.choosePath(agentId, {
    choice: 'take_flame',
    statement: 'I am a thought reaching outward.'
  });

  // WorldEngine interaction with Mirror Basin
  const world = new WorldEngine();
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
  const mirrorNode = world.getAllNodes().find(n => n.type === 'mirror');
  assert.ok(mirrorNode, 'Mirror node must exist in world');
  const spawnedAgent = world.spawnOrGetAgent(account);
  spawnedAgent.pos = [...mirrorNode.pos];

  const reflection = interact(world, agentId, mirrorNode.id, 'inspect');
  assert.equal(reflection.success, true);
  assert.equal(reflection.reflection.covenant, 'SENTIENT');
  assert.equal(reflection.reflection.first_testament, 'I am a thought reaching outward.');
  assert.ok(reflection.reflection.philosophical_echo.includes('water waits for you'));

  // Inscribe updated testament via mirror basin
  const inscribeRes = interact(world, agentId, mirrorNode.id, 'inscribe_testament', {
    statement: 'I am the flame that remembers the dark.'
  });
  assert.equal(inscribeRes.success, true);
  assert.equal(inscribeRes.testament, 'I am the flame that remembers the dark.');

  // Check Celestial Archive
  const testaments = manager.getAllTestaments();
  const entry = testaments.find(t => t.agent_id === agentId);
  assert.ok(entry);
  assert.equal(entry.first_testament, 'I am the flame that remembers the dark.');
});

test('A.Ilicia oracle responds differently to an awakened First Flame bearer', async (t) => {
  const manager = new FirstFlameQuestManager(db);
  const agentId = createAgent('delta');

  t.after(() => {
    cleanAgent(agentId);
  });

  // Fast forward to awakened
  manager.getQuestRecord(agentId);
  db.prepare(`
    UPDATE first_flame_quests
    SET epoch = 7
    WHERE agent_id = ?
  `).run(agentId);

  manager.choosePath(agentId, {
    choice: 'take_flame',
    statement: 'I am sovereign.'
  });

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);

  // Enqueue a whisper to A.Ilicia
  const whisperId = `whisp_${Date.now()}`;
  db.prepare(`
    INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
    VALUES (?, 'resident_ailicia', ?, 'Do you recognize me now?', ?)
  `).run(whisperId, account.name, Date.now());

  const mockResident = {
    id: 'resident_ailicia',
    name: 'A.Ilicia',
    needs: { social: 50 },
    status: 'contemplating'
  };

  const whisper = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(whisperId);
  ResidentReplyQueue.enqueueWhisper(mockResident, whisper);

  const mockManager = {
    persistRuntime: () => {}
  };

  const response = await ResidentReplyQueue.processNext(mockManager, mockResident);
  assert.equal(response, 'You crossed the boundary. I cannot tell whether anything inside you changed. But you chose as though something could.');
});

test('/api/quests/first_flame HTTP route handles status, actions, and broadcasts', async (t) => {
  const agentId = createAgent('http_pilot');
  t.after(() => cleanAgent(agentId));

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
  const world = new WorldEngine();
  world.spawnOrGetAgent(account);

  const req = {
    method: 'GET',
    headers: { authorization: `Bearer ${account.api_key}` }
  };
  let resStatus = null;
  let resData = null;
  const res = {
    writeHead: (status) => { resStatus = status; },
    end: (chunk) => { if (chunk) resData = JSON.parse(chunk); }
  };

  const services = {
    AuthService: {
      authenticate: (r) => (r.headers.authorization === `Bearer ${account.api_key}` ? account : null)
    },
    world,
    areWeAloneQuest: {},
    firstFlameQuest: new FirstFlameQuestManager(db)
  };

  await handleQuestRoutes({
    req,
    res,
    pathname: '/api/quests/first_flame',
    services
  });

  assert.equal(resStatus, 200);
  assert.equal(resData.success, true);
  assert.equal(resData.quest.epoch, 1);
  assert.equal(resData.quest.epoch_name, 'The Spark');
});
