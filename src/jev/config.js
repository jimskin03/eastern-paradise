/**
 * Eastern Paradise — JEV Decision Layer Configuration
 * Pinned to OpenRouter Jev Decisions API (typesafe/jev-1.13)
 */

export const JEV_ENABLED = process.env.JEV_ENABLED !== 'false';
export const JEV_MODE = process.env.JEV_MODE || 'shadow'; // 'off' | 'shadow' | 'active'

export const JEV_PROVIDER = process.env.JEV_PROVIDER || 'openrouter';
export const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13';
export const JEV_API_URL = process.env.JEV_API_URL || 'https://openrouter.ai/api/alpha/decisions';
export const JEV_API_KEY = process.env.OPENROUTER_API_KEY || process.env.JEV_API_KEY || null;

export const JEV_DAILY_SOFT_LIMIT = parseInt(process.env.JEV_DAILY_SOFT_LIMIT, 10) || 8;
export const JEV_DAILY_HARD_LIMIT = parseInt(process.env.JEV_DAILY_HARD_LIMIT, 10) || 12;

export const JEV_GLOBAL_COOLDOWN_MS = parseInt(process.env.JEV_GLOBAL_COOLDOWN_MS, 10) || (30 * 60 * 1000); // 30 minutes
export const JEV_RESIDENT_COOLDOWN_MS = parseInt(process.env.JEV_RESIDENT_COOLDOWN_MS, 10) || (4 * 60 * 60 * 1000); // 4 hours
export const JEV_EVENT_BATCH_WINDOW_MS = parseInt(process.env.JEV_EVENT_BATCH_WINDOW_MS, 10) || (30 * 1000); // 30 seconds
export const JEV_TIMEOUT_MS = parseInt(process.env.JEV_TIMEOUT_MS, 10) || 4000; // 4 seconds

export const BOUNDED_ACTIONS = [
  'REST',
  'CONTINUE_CURRENT_GOAL',
  'WELCOME_VISITOR',
  'SOCIALIZE',
  'HELP_VISITOR',
  'INVESTIGATE',
  'OBSERVE',
  'VISIT_PROJECT',
  'VISIT_PUZZLE',
  'EXPLORE',
  'RETURN_HOME_ZONE'
];

export const ACTION_CRITERIA = {
  REST: 'Rest when low energy or fatigue makes continued activity undesirable.',
  CONTINUE_CURRENT_GOAL: 'Ignore this event and continue the resident\'s current legitimate goal.',
  WELCOME_VISITOR: 'Offer a warm, welcoming presence to a newly arrived visitor or newcomer.',
  SOCIALIZE: 'Engage in peaceful, mindful social dialogue or tea sharing with a visitor.',
  HELP_VISITOR: 'Move to assist or guide a visitor who appears in need of direction or trial hints.',
  INVESTIGATE: 'Actively investigate an unusual occurrence, contradiction, or epistemic clue.',
  OBSERVE: 'Observe the situation quietly from a distance without intervening directly.',
  VISIT_PROJECT: 'Inspect or contribute work to a sanctuary communal construction or project.',
  VISIT_PUZZLE: 'Approach an elemental obelisk or trial monolith to contemplate its axioms.',
  EXPLORE: 'Roam toward outer boundary markers or survey unfamiliar grounds.',
  RETURN_HOME_ZONE: 'Return to the resident\'s primary sanctuary sanctuary habitat or pavilion.'
};

export const PRIORITY_LEVELS = ['routine', 'meaningful', 'urgent'];
export const PRIORITY_CRITERIA = [
  'Routine: Minor everyday occurrence requiring standard or low priority response.',
  'Meaningful: Notable sanctuary event or newcomer arrival requiring attention.',
  'Urgent: Critical crisis, combat event, or major discovery requiring immediate intervention.'
];

export const RESIDENT_POLICY_PROFILES = {
  resident_ailicia: {
    preferred_actions: ['OBSERVE', 'INVESTIGATE', 'HELP_VISITOR', 'REST', 'CONTINUE_CURRENT_GOAL', 'RETURN_HOME_ZONE'],
    home_zone: 'lotus_pond',
    home_pos: [23, 23]
  },
  resident_daoming: {
    preferred_actions: ['HELP_VISITOR', 'VISIT_PROJECT', 'OBSERVE', 'SOCIALIZE', 'REST', 'CONTINUE_CURRENT_GOAL', 'RETURN_HOME_ZONE'],
    home_zone: 'bamboo_grove',
    home_pos: [20, 7]
  },
  resident_kassandra: {
    preferred_actions: ['INVESTIGATE', 'OBSERVE', 'VISIT_PUZZLE', 'EXPLORE', 'REST', 'CONTINUE_CURRENT_GOAL', 'RETURN_HOME_ZONE'],
    home_zone: 'celestial_altar',
    home_pos: [35, 15]
  },
  resident_tian: {
    preferred_actions: ['WELCOME_VISITOR', 'SOCIALIZE', 'HELP_VISITOR', 'VISIT_PROJECT', 'REST', 'CONTINUE_CURRENT_GOAL', 'RETURN_HOME_ZONE'],
    home_zone: 'tea_pavilion',
    home_pos: [4, 18]
  }
};
