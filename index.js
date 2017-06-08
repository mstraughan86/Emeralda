const path 	= require('path');
require('dotenv').config({path: path.resolve(__dirname, '.env')});
const CronJob = require('cron').CronJob;
const mercuryCommand = require('../../index.js');
const util = require('../../util.js');
const mongoose = require('../../utilities/mongoose.js');
const COLLECTION = process.env.CRON_DB_COLLECTION;
const CronJobRecord = mongoose.createModel('CronJob', {
  active: Boolean,
  input: String,
  channel: String,
  name: String,
  command: String,
  cronPattern: String,
  second: String,
  minute: String,
  hour: String,
  monthdate: String,
  month: String,
  weekday: String,
});

let activeCronJobs = [];

const errorParseCommand = (args) => {
  let results = {errors: []};

  const regexCron = /^[0-9,\*\-\/]+$/;

  // This is what creates the Command List.
  // This is pretty dependent on Mercury's Charge...
  // TODO: Abstract this out! Refactor candidate.

  const commands = require('../../config/commands.json');
  const commandsList = [];
  commandsList.push.apply(commandsList, Object.keys(commands));
  Object.keys(commands).forEach((command) => {
    commandsList.push.apply(commandsList, commands[command].alias);
  });

  const checkCronPatternRange = (patternArray) => {
    const rangeMap = {
      0:{start:0,end:59},
      1:{start:0,end:59},
      2:{start:0,end:23},
      3:{start:1,end:31},
      4:{start:0,end:11},
      5:{start:0,end:6}
    };
    const checkRange = (key, num) => {
      num = parseInt(num);
      const start = rangeMap[key]['start'];
      const end = rangeMap[key]['end'];
      if (num < start || num > end) {
        results.errors.push(`Position ${key}: ${num} not accepted. Use ${start}-${end}.`);
      }
    };
    const regexNonnumeric = /[^0-9]/;

    patternArray.forEach((piece, i, array) =>{
      piece.split(regexNonnumeric).forEach(checkRange.bind(null, i));
    })
  };
  const checkCronPattern = (pattern) => {
    try {
      new CronJob(pattern, () => {
      })
    }
    catch (ex) {
      results.errors.push(`Cron Pattern '${pattern}': Doesn't pass the test!`);
    }
  };
  const checkRegexElement = (arg, i) => {
    if (!regexCron.test(arg)) {
      results.errors.push(`Position ${i}: ${arg} not accepted. Use: 0-9,*-/`);
    }
  };
  const checkCommandLength = (int) => {
    if (args.length < int) {
      results.errors.push(`Insufficient command length. See 'cron help' for instructions.`);
      results.message = results.errors.join('\n');
      return results;
    }
  };
  const checkJobCommand = (arg) => {
    if (!commandsList.includes(arg)) {
      results.errors.push(`Command ${arg}: Is not a known command or command alias.`);
    }
  };

  const command = args[0] || '"No Command"';
  if (['job', 'test', 'save'].includes(command)) {
    checkCommandLength(9);
    checkJobCommand(args[8]);
    args.slice(2, 8).forEach(checkRegexElement);
    checkCronPattern(args.slice(2, 8).join(' '));
    checkCronPatternRange(args.slice(2, 8));
  }
  else if (['stop', 'load'].includes(command)) {
    checkCommandLength(2);
    checkJobCommand(args[1]);
  }
  else if (['list', 'help'].includes(command)) {
  }
  else {
    results.errors.push(`Command ${command}: Is not a cron function. See 'cron help' for instructions.`);
  }

  results.message = results.errors.join('\n');
  if (!!results.message) {
    return Promise.reject({
      name: 'cron.errorParseCommand',
      type: 'Cron',
      message: 'User entered incorrect command.',
      error: results.message
    })
  }
  else {
    return Promise.resolve(args)
  }
};
const helpMessage = () => {
  const intro = "Cron Help\n\n";
  const description = "This is Cron for Slack, a time-based job scheduler that will execute slack commands for you! " +
    "You can schedule a job using a modified crontab format: second minute hour monthdate month weekday. The ranges " +
    "for each value are: \n" +
    "     second: 0-59\n" +
    "     minute: 0-59\n" +
    "       hour: 0-23\n" +
    "  monthdate: 1-31\n" +
    "      month: 0-11\n" +
    "    weekday: 0-6\n" +
    "You also have Asterisks (*), Ranges (1-3,5), and Steps (*/2) available to use. For example, '00 30 11 * * 1-5' " +
    "means it runs every weekday (Monday through Friday) at 11:30:00 AM. It does not run on Saturday or Sunday. \n\n" +
    "You must specify every job with a name. This is because every job fires indefinitely until stopped, and is only " +
    "referenced by its designated name. No spaces are allowed in your name and quotes don't help. \n\n" +
    "You can only fire any command available by this slack bot. For example, 'cron job help-everyday 00 00 00 * * * help' " +
    "would fire the help command everyday at midnight, if that is your thing.\n\n";
  const commandsDescription = [
    "cron job name * * * * * * command args...  :    Run cron job at designated time. Saves it by name.",
    "cron test name * * * * * * command args... :    Test cron job pattern and command right now.",
    "cron save name * * * * * * command args... :    Save cron job. Does not run job.",
    "cron load name              :    Start cron job by name.",
    "cron delete name            :    Delete cron job by name.",
    "cron stop name              :    Stop cron job by name.",
    "cron list                   :    List all currently running cron jobs and saved cron jobs.",
    "cron help                   :    Displays this help text.",
  ].join('\n');

  return Promise.resolve(intro + description + commandsDescription);
};
const testCronPattern = (args) => {
  const input = args.join(' ');
  const cronPattern = args.slice(2, 8);
  const name = args[1];
  const command = args.slice(8, args.length).join(' ');
  const dayMap = {0:'Sun',1:'Mon',2:'Tues',3:'Wed',4:'Thu',5:'Fri',6:'Sat'};

  cronPattern[5] = cronPattern[5]
    .split('')
    .map(c => dayMap[c] || c)
    .join('');

  cronPattern.forEach((element, index, array) => {
    if (/[,\*\-\/]/.test(element)) {
      element = element.replace(/[\*]/, "every");
      element = element.replace(/[\-]/, " through ");
      element = element.replace(/[,]/, " and ");
      if (/[\/]/.test(element)) {
        element = element.replace(/[\/]/, " ");
        element = element + '-th';
      }
      array[index] = element;
    }
  });

  const parsedSchedule = `
Your input: ${input}
Your cron job name: ${name}
Your cron job schedule:
          second: ${cronPattern[0]}
          minute: ${cronPattern[1]}
            hour: ${cronPattern[2]}
       monthdate: ${cronPattern[3]}
           month: ${cronPattern[4]}
         weekday: ${cronPattern[5]}\n`;
  const parsedCommand = "Your cron job command: \n" + command;

  return Promise.resolve(parsedSchedule + parsedCommand);
};
const saveCronPattern = (args) => {
  const input = args.join(' ');
  const cronPattern = args.slice(2, 8);
  const name = args[1];
  const command = args.slice(8, args.length).join(' ');


  var venuesDirFromRootDir = './commands/scraper/venues/';
  fs.readdir(venuesDirFromRootDir, function (err, files) {
    files.forEach(function (filename) {
      supportedVenues.push(filename.split('.')[0]);
    });
  });

  // ---- Blacklist/Whitelist Subsystem ---- //

  // Display both venue black and white lists
  let showBlacklist = function () {
    let messageTitle = "Show Blacklist and Whitelist\n\n"
    let blacklistedVenues = "Blacklist:\n" + getBlacklist().join(', ');
    let whitelistedVenues = "\n\nWhitelist:\n" + getWhitelist().join(', ');

    util.promisePostMessage(channel, messageTitle + blacklistedVenues + whitelistedVenues);
  };

  // Derive the venue white from config.json and supportedVenues
  let getWhitelist = function () {

    let blacklistedVenuesArray = getBlacklist();
    return supportedVenues.filter(function (venue) {
      return !blacklistedVenuesArray.includes(venue);
    });
  };

  // Remove a venue from the scraper blacklist in config.json
  let setWhitelist = function (venuesToWhitelist) {
    loadConfigurationFile();

    let blacklistedVenuesArray = nconf.get('blacklist');
    venuesToWhitelist.forEach((venue) => {
      let i = blacklistedVenuesArray.indexOf(venue);
      if (i > -1) {
        blacklistedVenuesArray.splice(i, 1);
      }
    });

    saveConfigurationFile();
    let message = 'Blacklisted Venues: \n' + blacklistedVenuesArray;
    util.promisePostMessage(channel, message);
  };

  // Get the venue blacklist in config.json
  let getBlacklist = function () {
    loadConfigurationFile();
    return nconf.get('blacklist');

    // consider checking if nconf config file even HAS blacklist.
    // this might be very simple.

  };

  // Add a venue to the scraper blacklist in config.json
  let setBlacklist = function (venuesToBlacklist) {
    loadConfigurationFile();

    let blacklistedVenuesArray = nconf.get('blacklist');
    venuesToBlacklist.forEach((venue) => {
      if (blacklistedVenuesArray.indexOf(venue) < 0) {
        blacklistedVenuesArray.push(venue);
      }
    });

    saveConfigurationFile();
    let message = 'Blacklisted Venues: \n' + blacklistedVenuesArray;
    util.promisePostMessage(channel, message);
  };

  // Save config.json file using nconf
  let saveConfigurationFile = function () {
    nconf.save(function (err) {
      if (err) {
        console.error(err.message);
        return;
      }
      console.log('Configuration saved successfully.');
    });
  };

  // Load config.json file using nconf
  let loadConfigurationFile = function () {
    let scraperConfig = './config/scraper_config.json';
    nconf.file({file: scraperConfig});
    nconf.load();
  };






};

// module.exports = function (param) {
//   let sitemapRegeneration = new CronJob({
//     cronTime: '*/5 * * * * *',       // Runs everyday at 04:30
//     onTick: util.postMessage.bind(null, param.channel, 'Cron.'),             // Execute updateEvents() at cronTime
//     //runOnInit: true,                // Fire immediately
//     start: true,                      // Start script (to fire at cronTime)
//     timeZone: 'America/Los_Angeles'   // ...?
//   });
// };

const main = (param) => {
  // param object contains the following keys:
  // 1. command - the primary command name
  // 2. args - an array of strings, which is user's message posted in the channel, separated by space
  // 3. user - Slack client user id
  // 4. channel - Slack client channel id
  // 5. commandConfig - the json object for this command from config/commands.json

  const user = param.user;
  const channel = param.channel;

  errorParseCommand(param.args)
    .then((args) => {
      const command = param.args[0];
      switch (command) {
        case 'help': return helpMessage().then(msg => util.postMessage(channel, msg));
        case 'test': return testCronPattern(args).then(msg => util.postMessage(channel, msg)); // doesn't run the command.
        case 'list':
          //
          list();
          break;
        case 'stop':
          stop();
          break;
        case 'save':

          // https://www.bennadel.com/blog/3244-non-module-file-paths-are-relative-to-the-working-directory-in-node-js.htm
          // I need to figure out how to solve relative paths for this. Because i need to test in its own project, + from slack.

          // No, this is not an independent submodule, this will ONLY be used in Slack. there is zero reason to make this modular for paths.
          // Too much work for zero benefit. Play where it lays.

          saveCronPattern();
          break;
        case 'load':
          load();
          break;
        case 'job':
          job();
          break;
        case 'delete': //zero work has been done to integrate this. even in error parsing.
          break;
        default:
          return util.postMessage(channel, "Expecting something else, type 'cron help'");
        // }
      }
    })
    .then()
    .catch((error) => {util.postMessage(channel, error.error)});
};

module.exports = main;