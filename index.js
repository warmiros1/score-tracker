'use strict';

const App = require('actions-on-google').ApiAiApp;
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

//connect to firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://score-keeper-7ad52.firebaseio.com"
});

const gameIncludes = [
  'Right now, the players are ',
  'The players in the game are ',
  'Everyone playing right now is '
];
const endGamePhrase = [
  'No problem. Come back soon for a new game!',
  'Okay. Use Score Tracker again for your next game!',
  'Got it. Talk to Score Tracker again for a game with new players!',
  'Got it. Start a new game any time you want!'
];

function getRandomElem (array) {
  var randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

// Mergesort algorithm to output users in descending order of score
function mergeSort(arr) {
    if (arr.length < 2)
        return arr;

    var middle = parseInt(arr.length / 2);
    var left   = arr.slice(0, middle);
    var right  = arr.slice(middle, arr.length);

    return merge(mergeSort(left), mergeSort(right));
}

function merge(left, right) {
    var result = [];

    while (left.length && right.length) {
        if (left[0][0].score <= right[0][0].score) {
            result.push(left.shift());
        } else {
            result.push(right.shift());
        }
    }

    while (left.length)
        result.push(left.shift());

    while (right.length)
        result.push(right.shift());

    return result;
}

// Converts array of players into a speakable/readable English string
function stringifyPlayers (players, withPoints) {
  if (players.length === 0) {
    return null;
  }
  var retStr = '';

  if (players.length > 1 && !withPoints) {
    retStr = players[0].name;
    for (var i = 1; i < players.length-1; i++) {
      retStr += ', ' + players[i].name; //add subsequent players
    }
    retStr += ' and ' + players[players.length-1].name;
  } else if (withPoints) {
    var playerGroups = [], sortedGroups = [], visited = [];
    var groupIdx = -1;
    for (var i = 0; i < players.length; i++) {
      visited.push(false); //initialize an array corresponding to all players
    }

    //this nested loop groups all players with the same score together
    for (var i = 0; i < players.length; i++) {
      for (var j = 0; j < players.length; j++) {
        if (!visited[i] && !visited[j]) {
          playerGroups.push(new Array(players[i]));
          groupIdx++;
          visited[i] = true;
        }
        if (!visited[j] && players[i].score === players[j].score) {
          playerGroups[groupIdx].push(players[j]);
          visited[j] = true;
        }
      }
    }
    sortedGroups = mergeSort(playerGroups); //sort the groups by their scores to say in order

    retStr += pluralCheck(sortedGroups, sortedGroups.length-1);
    if (sortedGroups.length > 1) {
      for (var i = sortedGroups.length-2; i > 0; i--) {
        retStr += ', ' + pluralCheck(sortedGroups, i);
      }
      retStr += ' and ' + pluralCheck(sortedGroups, 0);
    }
  } else {
    retStr = players[0].name;
  }
  return retStr;
}

// Helper function for stringify to make speech more natural
function pluralCheck (sortedGroups, groupIdx) {
  if (sortedGroups[groupIdx][0].score === 1) {
    var retStr = stringifyPlayers(sortedGroups[groupIdx], false) + ' with ' + sortedGroups[groupIdx][0].score + ' point';
  } else {
    var retStr = stringifyPlayers(sortedGroups[groupIdx], false) + ' with ' + sortedGroups[groupIdx][0].score + ' points';
  }
  if (sortedGroups[groupIdx].length > 1) {
    retStr += ' each';
  }
  return retStr;
}

// Encodes characters in UTF for firebase key
function encodeAsFirebaseKey (string) {
  return string.replace(/%/g, '%25')
    .replace(/\./g, '%2E')
    .replace(/#/g, '%23')
    .replace(/\$/g, '%24')
    .replace(/\//g, '%2F')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D');
}

// Removes duplicate from player inputs by users (i.e. add Will and Will => add will)
function removeDupes (arr) {
  var tempArr = arr.slice();
  var retArr = [];
  for (var i = 0; i < tempArr.length; i++) {
    for (var j = 0; j < tempArr.length; j++) {
      if (tempArr[i] && i !== j && tempArr[i] === tempArr[j]) {
        tempArr[j] = false; //removes duplicate names without changing indices
      }
    }
  }
  for (var i = 0; i < tempArr.length; i++) {
    if (tempArr[i]) {
      retArr.push(tempArr[i]); //removes falses
    }
  }
  return retArr;
}

exports.scoreKeeper = (request, response) => {
  const app = new App({ request, response });

  // Outputs speechoutput with voice, then always lists the current standing as text with default suggestion chips
  function askWithSuggestion (app, speechOutput) {
    app.data.speech = speechOutput; //store speechoutput for access after DB read
    readFromDB(app, askWithSuggestionHelp); //otherwise create rich response with gameData for phone
  }

  function askWithSuggestionHelp (app, gameData) {
    if (gameData.players.length > 1) {
      var text = getRandomElem(gameIncludes) + stringifyPlayers(gameData.players, true) + '. ';
    } else {
      var text = 'The only one in the game is ' + stringifyPlayers(gameData.players, true) + '. '; //more natural for 1 player
    }
    var speechOutput = app.data.speech + text;
    var outputText = speechOutput + 'What would you like to do next?';
    app.data.speech = ''; //reset speech local data

    var hasScreen = app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT);
    if (!hasScreen) {
      app.tell(speechOutput); //end conversation if on Google Home
    } else {
      app.ask(app.buildRichResponse() 
        .addSimpleResponse(outputText)
        .addSuggestions(['Everyone gets 1 point', 'Everyone loses 1 point', 'Get help'])
      );
    }
  }

  // In case something goes wrong, don't use askWithSug so as to not end convo on Home
  function errorAsk (app, speechOutput) {
    app.ask(app.buildRichResponse()
      .addSimpleResponse(speechOutput)
      .addSuggestions(['Get help', 'List Players'])
    );
  }

  // Reads the current player data from database, also acts as a check against performing any functions without players in the game
  function readFromDB (app, callback, isAdding) {
    return new Promise(function (resolve, reject) {
      var userId = app.getUser().user_id;
      var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
      usersRef.once('value', function (data) {
        if (data && data.val() && data.val().players) {
          resolve(callback(app, data.val())); //When game data loads, pass it to callback
        } else if (isAdding) {
          console.log('About to start new game for:', userId);
          resolve(callback(app, [])); //case of adding players to empty game
        } else {
          resolve(noOneInGame(app));
        }
      });
    });
  }

  // Function that executes when user tries to do stuff before adding players
  function noOneInGame(app) {
    app.ask(app.buildRichResponse()
      .addSimpleResponse('No one\'s playing yet! To get started, list the players to add to the game or say "get help" to start the tutorial.')
      .addSuggestions(['Get help'])
    );
  }

  // Handles default welcome intent
  function startConversation (app) {
    console.log('Handling welcome intent');
    readFromDB(app, listPlayersHelp); //runs list players if no command specified
  }

  function tutorial (app) {
    console.log('Giving user tutorial');
    readFromDB(app, tutorialHelp, true); //pretend we're adding players so this still works for empty games
  }

  function tutorialHelp (app, gameData) {
    var text = 
      'To add or remove players at any time speak or type all of their names. You cannot add duplicate players and some unique names \
are not supported. To modify scores you can say for example: "add 3 points to Tom and Jerry," or "set Tom\'s score to 0," or \
"Remove 1 point from everyone," or "Set everyone\'s score to 20." You can say "end game" to end the game and declare a winner. ';
    if (gameData && gameData.players && gameData.players.length > 0) {
      askWithSuggestion(app, text); //case of already in game
    } else {
      text += 'To get started, list the names of the players you want to add now!';
      app.ask(text); //case of no players in game, prompt user for names
    }

  }

  // Does not allow user to add duplicate players, then prompts for confirmation to add listed players
  function confirmPlayers (app) {
    console.log('In confirm players intent for', app.getArgument('players'));
    readFromDB(app, confirmPlayersHelp, true);
  }

  function confirmPlayersHelp(app, gameData) {
    var playersToAdd = app.getArgument('players');
    var playersWithoutDupes = [];
    app.data.tempPlayers = [];
    var flag = false;
    var player;
    playersToAdd = removeDupes(playersToAdd); //removes duplicate names from argument

    if (gameData.players && gameData.players.length > 0) {
      playersToAdd.forEach(function(personToAdd) {
        for (var i = 0; i < gameData.players.length; i++) {
          player = gameData.players[i];
          if (personToAdd == player.name) {
            flag = true; //rule out duplicates
          }
        }
        if (!flag) {
          playersWithoutDupes.push(personToAdd);
        }
        flag = false;
      });
    } else {
      playersToAdd.forEach(function(player) {
        playersWithoutDupes.push(player);
      });
    }

    if (playersWithoutDupes.length === 0) {
      errorAsk(app, 'You can\'t add duplicate players to the game. List the players you would like to add instead, or say "get help."');
      return;
    }

    for (var i = 0; i < playersWithoutDupes.length; i++) {
      //create JSON representation of each player and store locally
      app.data.tempPlayers.push(
        {
          "name": playersWithoutDupes[i],
          "score": 0
        }
      );
    }

    app.ask(app.buildRichResponse()
      .addSimpleResponse('You want to add ' + stringifyPlayers(app.data.tempPlayers, false) + ' to the game, is that right?')
      .addSuggestions(['Yes', 'No', 'Never mind'])
    );
  }

  // Once confirmation is received, add the players to the game and update the DB
  function addPlayers (app) {
    console.log('In add players function');
    readFromDB(app, addPlayersHelp, true); //isAdding = true, will return empty array
  }

  //Adds all new players to player map and sets their scores to 0 if user confirms addPlayers intent
  function addPlayersHelp(app, gameData) {
    var userId = app.getUser().user_id;
    var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));

    if (!gameData.players || gameData.players.length === 0) {
      var totalPlayers = app.data.tempPlayers;
    } else {
      var Players = gameData.players.slice();
      var tempPlayers = app.data.tempPlayers;
      var totalPlayers = tempPlayers.concat(Players);
    }

    usersRef.update({
        players: totalPlayers
    });
    app.data.tempPlayers = []; //clear to be sure
    askWithSuggestion(app, 'I added them to the game. ');
  }

  //checks if at least one player is in the game, returns to score keeping mode if so. Otherwise, prompts for at least one player
  function cancelAddPlayers (app) {
    console.log('In cancel add players function');
    readFromDB(app, cancelAddPlayersHelp); //called to check if players are in the game
  }

  function cancelAddPlayersHelp (app, gameData) {
    askWithSuggestion(app, 'Okay, I won\'t add them. '); //only triggers if there are players in the game
  }

  // Checks that all listed players exist within the game, then prompts for confirmation to remove them
  function confirmRemoval (app) {
    console.log('Confirming removal function to remove', app.getArgument('players'));
    readFromDB(app, confirmRemovalHelp); //still adding players, need the third arg
  }

  function confirmRemovalHelp (app, gameData) {
    var playersToRemove = app.getArgument('players');
    playersToRemove = removeDupes(playersToRemove);
    var indicesToRemove = [], playersThatExist = [];
    var flag = false;

    for (var i = 0; i < playersToRemove.length; i++) {
      for (var j = 0; j < gameData.players.length; j++) {
        if (gameData.players[j].name === playersToRemove[i]) {
          flag = true;
          break;
        }
      }
      if (flag) {
        indicesToRemove.push(j); //push idx of player to remove in firebase
        playersThatExist.push(gameData.players[j]); //keep in JSON format for stringify compatibility
      }
      flag = false;
    }

    if (indicesToRemove.length === 0) {
      errorAsk(app, 'You can only remove players that are in the game. Say "list players" to hear who\'s in the game, \
          or "end game" to remove everyone.');
      return;
    }
    app.data.removalIdx = indicesToRemove; // store indices in local data

    app.ask(app.buildRichResponse()
      .addSimpleResponse('You want to remove ' + stringifyPlayers(playersThatExist, false) + ' from the game, is that right?')
      .addSuggestions(['Yes', 'No', 'Never mind'])
    );
  }

  // Actually removes all listed players, and if no players remain prompt to add more
  function removePlayers (app) {
    console.log('In remove players function for players at indices:', app.data.removalIdx);
    readFromDB(app, removePlayersHelp);
  }

  function removePlayersHelp (app, gameData) {
    var userId = app.getUser().user_id;
    var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
    var players = gameData.players.slice();
    var idxArr = app.data.removalIdx;
    var newPlayers = [];

    for (var i = 0; i < idxArr.length; i++) {
      players[idxArr[i]] = ''; //make the slots for former players falsy
    }
    for (var i = 0; i < players.length; i++) {
      if (players[i]) {
        newPlayers.push(players[i]); //push unremoved players to new array
      }
    }

    usersRef.update({
      players: newPlayers //those that are now empty brackets will be deleted
    });
    if (newPlayers.length === 0) {
      app.ask(app.buildRichResponse() //if we are here, we removed all players
        .addSimpleResponse('I removed all players. To start a new game, list the players to add to the game or say "get help" to start the tutorial.')
        .addSuggestions(['Get help'])
      );
    } else {
      askWithSuggestion(app, 'I removed them. ');
    }
  }

  function cancelRemoval (app) {
    askWithSuggestion(app, 'Okay, I won\'t remove them. ');
  }

  //list all players in the game with their scores using stringify players
  function listPlayers (app) {
    console.log('In list players function');
    readFromDB(app, listPlayersHelp);
  }

  function listPlayersHelp (app, gameData) {
    if (gameData.players.length > 1) {
      var text = getRandomElem(gameIncludes) + stringifyPlayers(gameData.players, true) + '. ';
    } else {
      var text = 'The only one in the game is ' + stringifyPlayers(gameData.players, true) + '. '; //more natural for 1 player
    }
    var hasScreen = app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT);
    text += 'What would you like to do now?';
    if (hasScreen) {
      app.ask(app.buildRichResponse() //Can't use askWithSuggestion cuz it would repeat itself on assistant app
        .addSimpleResponse(text) 
        .addSuggestions(['Everyone gets 1 point', 'Everyone loses 1 point', 'Get help'])
      );
    } else {
      app.ask(text); 
    }
  }

  //adds or removes a given amount of points from given users or everyone, or sets give users or everyone to a given amount
  function changePoints (app) {
    console.log('In change points function');
    readFromDB(app, changePointsHelp);
  }

  function changePointsHelp (app, gameData) {
    var userId = app.getUser().user_id;
    var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
    var intent = app.getIntent(); //3 intents that modify score are directed here
    var amt = app.getArgument('amount').points || 2; //If user is speaking and says "two"
    if (amt < 0) { amt = 0; } //do not allow negative values
    console.log('Intent: %s, amt: %d, everyone argument: %s, players argument:', intent, amt, app.getArgument('everyone'), app.getArgument('players'));
    var newPlayers = gameData.players.slice();
    var speechOutput = '', changePlayers = [], modifiedScore = [];

    if (app.getArgument('everyone')) {
      for (var i = 0; i < newPlayers.length; i++) {
        if (intent === 'add.points') {
          newPlayers[i].score += amt;
          speechOutput = amt + ' points added to everyone. ';
        } else if (intent === 'remove.points') {
          newPlayers[i].score -= amt;
          speechOutput = amt + ' points removed from everyone. ';
          if (newPlayers[i].score < 0) { newPlayers[i].score = 0; }
        } else if (intent === 'set.points') {
          newPlayers[i].score = amt;
          speechOutput = 'Everyone\'s score has been set to ' + amt + '. ';
        } else {
          errorAsk(app, 'Uh-oh! I didn\'t quite understand that, make sure to include whether you want to add, remove, or set points.');
          return;
        }
      }
    } else if (app.getArgument('players')) {
      var players = app.getArgument('players'); //also stored as an object, dereferenced in nest for loop
      players = removeDupes(players);
      for (var i = 0; i < players.length; i++) {
        changePlayers.push(players[i].players); //get just their names
      }
      changePlayers = removeNonexistent(changePlayers, gameData); 
      if (changePlayers.length === 0) {
        errorAsk(app, 'You can only modify the scores of players in the game.');
      }
      for (var i = 0; i < gameData.players.length; i++) {
        for (var j = 0; j < players.length; j++) {
          if (gameData.players[i].name === players[j].players) {
            modifiedScore.push(gameData.players[i]);
            if (intent === 'add.points') {
              newPlayers[i].score += amt;
              speechOutput = amt + ' points added to ';
            } else if (intent === 'remove.points') {
              newPlayers[i].score -= amt;
              speechOutput = amt + ' points removed from ';
              if (newPlayers[i].score < 0) { newPlayers[i].score = 0; }
            } else if (intent === 'set.points') {
              if (amt < 0) { amt = 0; }
              newPlayers[i].score = amt;
              speechOutput = 'Their score has been set to ' + amt + '. ';
            } else {
              errorAsk(app, 'Uh-oh! I didn\'t quite understand that, make sure to include whether you want to add, remove, or set points. ');
              return;
            }
            break;
          }
        }
      }
      speechOutput += stringifyPlayers(modifiedScore) + '. '; //add affected players to list
    } else {
      errorAsk(app, 'Say "give ' + amt + ' to a player," "remove ' + amt + ' from a player," or "set a player\'s score to ' + amt + '." ');
      return;
    }

    if (newPlayers === gameData.players) {
      errorAsk(app, 'Please say the amount of points you\'d like to add and players in this game who will receive them. ');
    } else {
      usersRef.update({
        players: newPlayers //those that are now empty brackets will be deleted
      });
      var singular
      if (amt === 1) {
        askWithSuggestion(app, speechOutput.replace(/points/, 'point')); //account for singular
      } else {
        askWithSuggestion(app, speechOutput);
      }
    }
  }

  // Helper function to remove players not in the game from an array of players
  function removeNonexistent (players, gameData) {
    var flag = false;
    var playersThatExist = [];

    for (var i = 0; i < players.length; i++) {
      for (var j = 0; j < gameData.players.length; j++) {
        if (gameData.players[j].name === players[i]) {
          flag = true;
          break;
        }
      }
      if (flag) {
        playersThatExist.push(gameData.players[j].name);
      }
      flag = false;
    }
    return playersThatExist;
  }

  // Prompts for confirmation to end game
  function confirmEndGame (app) {
    console.log('Prompting for confirmation of ending game.');
    readFromDB(app, confirmEndGameHelp);
  }

  function confirmEndGameHelp (app, gameData) {
    
    var speechOutput = 'Are you sure you want to end the current game? ';
    if (gameData.players.length > 1) {
      speechOutput += getRandomElem(gameIncludes) + stringifyPlayers(gameData.players, true) + '.';
    } else {
      speechOutput += 'The only one in the game is ' + stringifyPlayers(gameData.players, true) + '.'; //more natural for 1 player
    }

    app.ask(app.buildRichResponse() 
      .addSimpleResponse(speechOutput)
      .addSuggestions(['Yes', 'No'])
    );
  }

  // Ends the current game, declares a winner, and prompts to start a new game with the same players
  function endGame (app) {
    console.log('End game confirmed, prompting for new one.');
    readFromDB(app, endGameHelp);
  }

  function endGameHelp (app, gameData) {
    var highest = 0;
    var winningPlayers = [];
    for (var i = 0; i < gameData.players.length; i++) {
      if (gameData.players[i].score > highest) {
        highest = gameData.players[i].score;
        winningPlayers = []; //clear previous players
        winningPlayers.push(gameData.players[i]); //push player object to be stringified
      } else if (gameData.players[i].score === highest) {
        winningPlayers.push(gameData.players[i]);
      }
    }

    var speechOutput = 'Okay, I ended this game. '
    var cardTitle;
    if (winningPlayers.length === 1) {
      speechOutput += 'And the winner is ' + stringifyPlayers(winningPlayers, true) + '. Do you want to start a new game with the same players?';
      cardTitle = 'And the winner is...';
    } else {
      speechOutput += 'And the winners are ' + stringifyPlayers(winningPlayers, true) + '. Do you want to start a new game with the same players?';
      cardTitle = 'And the winners are...';
    }
    app.ask(app.buildRichResponse()
      .addSimpleResponse({speech: speechOutput, displayText: 'Okay, I ended this game.'})
      .addBasicCard(app.buildBasicCard(stringifyPlayers(winningPlayers, true) + '. Do you want to start a new game with the same players?')
        .setTitle(cardTitle) //will be singular or plural
        .setImage('https://storage.googleapis.com/score_keeper_bucket/first-place.png', 'First Prize')
      )
      .addSuggestions(['Yes', 'No'])
    );
  }

  // Clears players out of DB and ends conversation
  function finishGame (app) {
    console.log('User does not want to start new game, clearing players.');
    var userId = app.getUser().user_id;
    var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
    usersRef.update({
      players: [] //clear players array
    });
    app.tell(getRandomElem(endGamePhrase)); //end conversation for good
  }

  // Effectively the same as "set everyone's score to 0"
  function newGame (app) {
    console.log('Beginning a new game with same players');
    readFromDB(app, newGameHelp);
  }

  function newGameHelp (app, gameData) {
    var userId = app.getUser().user_id;
    var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
    var newPlayers = gameData.players.slice();
    for (var i = 0; i < newPlayers.length; i++) {
      newPlayers[i].score = 0;
    }
    usersRef.update({
      players: newPlayers //updates players with 0 score
    });
    askWithSuggestion(app, 'Awesome! Everyone\'s scores have been reset and a new game has been started! ');
  }

  let actionMap = new Map();
  actionMap.set('start.game', startConversation);
  actionMap.set('get.help', tutorial);
  actionMap.set('confirm.players', confirmPlayers);
  actionMap.set('add.players', addPlayers);
  actionMap.set('cancel.players', cancelAddPlayers);
  actionMap.set('confirm.remove', confirmRemoval);
  actionMap.set('remove.players', removePlayers);
  actionMap.set('cancel.remove', cancelRemoval);
  actionMap.set('list.players', listPlayers)
  actionMap.set('add.points', changePoints);
  actionMap.set('remove.points', changePoints);
  actionMap.set('set.points', changePoints);
  actionMap.set('confirm.end', confirmEndGame);
  actionMap.set('end.game', endGame);
  actionMap.set('finish.game', finishGame);
  actionMap.set('new.game', newGame);
  app.handleRequest(actionMap);
};