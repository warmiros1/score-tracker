'use strict';

//process.env.DEBUG = 'actions-on-google:*';
const App = require('actions-on-google').ApiAiApp;
//let playerMap = new Map(); //Map for all players and their scores

//returns a random selection from an array
function getRandomElem (array) {
  var randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

//converts array of players into a speakable/readable English string
function stringifyPlayers (players) {
  if (players.length === 0) {
    return null;
  }
  var retStr = players[0];
  if (players.length > 1) {
    for (var i = 1; i < players.length-1; i++) {
      retStr += ', ' + players[i]; //add subsequent players
    }
    retStr += ' and ' + players[players.length-1];
  }
  return retStr;
}

function encodeAsFirebaseKey (string) {
  return string.replace(/%/g, '%25')
    .replace(/\./g, '%2E')
    .replace(/#/g, '%23')
    .replace(/\$/g, '%24')
    .replace(/\//g, '%2F')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D');
}


    //Fuck it, just use firebase realtime DB to store all the player data
    //And include a hasScreen check - use our current responses if hasScreen is true, else end the conversation cuz the google 
    //home will pick up interference from back ground noise otherwise

    //Include isInGame boolean that's only false when user says to end the game and doesnt start a new one


//CODE TO READ FROM DATABASE
return new Promise(function (resolve, reject) {
  var userId = app.getUser().user_id;
  var permission = app.SupportedPermissions.DEVICE_PRECISE_LOCATION;
  app.data.permission = permission;
  var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
  var hasScreen = app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT);
  console.log('Is the user on a phone?', hasScreen);
  usersRef.once('value', function (data) {
    if (data && data.val() && data.val().location && data.val().location.coordinates && (data.val().location.address || hasScreen)) {
      console.log('Location data stored in firebase:', data.val());
      app.data.location = data.val().location;
      resolve(getTimeZone(app));
    } else {
      app.setContext('requesting_permission', 1); //set appropriate context
      console.log('No data in firebase detected, asking for location permission.'); //or they're on a Home for the first time & we want address
      resolve(app.askForPermission('Welcome to Mower Plus! To get weather near you', permission));
    }
  });
});

//CODE TO WRITE TO DATABASE
let userId = app.getUser().user_id;
app.data.location = app.getDeviceLocation();

var usersRef = admin.database().ref('users/' + encodeAsFirebaseKey(userId));
usersRef.update({
  "location/coordinates": app.data.location.coordinates
});


exports.scoreKeeper = (request, response) => {
  const app = new App({ request, response });

  //takes speechOutput and array of suggestion chips as args to output a response
  function askWithSuggetion (speechOutput) {
    console.log('Asking with sug, app data:', JSON.stringify(app.data));
    var text = '';
    //var players = app.data.players;
    for (var i = 0; i < app.data.players.length-1; i++) {
      text += app.data.players[i].name + ': ' + app.data.players[i].score + '  '; //adds players and scores to display text
    }
    text += app.data.players[app.data.players.length-1].name + ': ' + app.data.players[app.data.players.length-1].score;

    app.ask(app.buildRichResponse() 
      .addSimpleResponse(speechOutput)
      .addBasicCard(app.buildBasicCard(text))
      .addSuggestions(['Set everyone\'s score', 'Everyone gets points', 'Everyone loses points', 'Get help'])
    );
  }

  //check if there are any players yet and prompts for them if not
  function noPlayersInGame (app) {
    if (app.data.players.length === 0) {
      console.log('Attempted intent without any players, reprompting for players');
      app.ask(app.buildRichResponse()
        .addSimpleResponse('You must list at least one player to add to this game, or say "get help" to start the tutorial.')
        .addSuggestions(['Get help'])
      );
      return true;
    }
    return false;
  }

  //Prompts the user to confirm the addition of all players. Can assume players won't be empty because it's required
  function confirmPlayers () {  
    var players = app.getArgument('players');
    console.log('In confirm players intent for', players, ' || App data:', JSON.stringify(app.data));
    var playersWithoutDupes = [];
    app.data.tempPlayers = [];
    var flag = false;
    var player;

    if (app.data.players) {
      players.forEach(function(personToAdd) {
        for (var i = 0; i < app.data.players.length; i++) {
          player = app.data.players[i];
          console.log('Person to add:', personToAdd, 'Current active player:', player.name, '|| flag:', flag);
          if (personToAdd == player.name) {
            flag = true; //rule out duplicates
          }
        }
        if (!flag) {
          playersWithoutDupes.push(personToAdd);
        }
        console.log('Person to add:', personToAdd, 'players no dupes:', playersWithoutDupes, '|| flag:', flag);
        flag = false;
      });
    } else {
      players.forEach(function(player) {
        playersWithoutDupes.push(player);
      });
    }

    if (playersWithoutDupes.length === 0) {
      app.ask('You can\'t add duplicate players to the game. List the players you would like to add instead, or say cancel.');
      return;
    }
    playersWithoutDupes.forEach(function(player) {
      app.data.tempPlayers.push(player); //stores players to be added
    });

    app.ask(app.buildRichResponse()
      .addSimpleResponse('You want to add ' + stringifyPlayers(playersWithoutDupes) + ' to the game, right?')
      .addSuggestions(['Yes', 'No', 'Never mind'])
    );
  }

  //Adds all new players to player map and sets their scores to 0 if user confirms addPlayers intent
  function addPlayers () {
    console.log('In add players function');
    //var players = app.data.tempPlayers;
    
    if (!app.data.players) {
      app.data.players = []; //if undefined, create empty array to store players
    }
    console.log('Players in game:', JSON.stringify(app.data.players));

    for (var i = 0; i < app.data.tempPlayers.length; i++) {
      app.data.players.push(
        {
          "name": app.data.tempPlayers[i],
          "score": 0
        }
      ); //add each player to app player data with score of 0
    }

    console.log('All active players after adding new ones:', JSON.stringify(app.data.players));
    askWithSuggetion('I added them to the game.');
  }

  //checks if at least one player is in the game, returns to score keeping mode if so. Otherwise, prompts for at least one player
  function cancelAddPlayers (app) {
    console.log('In cancel add players function');
    if (noPlayersInGame(app)) {
      return;
    }
    askWithSuggetion(app, 'Okay, I won\'t add them.');
  }

  //list all players in the game with their scores in the format "NAME1 has AMT1 points, NAME2 has AMT2 points..."
  function listPlayers (app) {
    console.log('In list players function');
    if (noPlayersInGame(app)) {
      return;
    }

    var players = app.data.players;
    var speechOutput = text = 'Currently playing is:'; //double space for line break
    var cardText = '';

    for (var i = 0; i < players.length-1; i++) {
      cardText += players[i].name + ': ' + players[i].score + '  '; //adds players and scores to display text
      speechOutput += players[i].name + ' with ' + players[i].score + ' points, ';
    }
    cardText += players[players.length-1].name + ': ' + players[players.length-1].score
    if (players.length > 1) {
      speechOutput += ' and ';
    }
    speechOutput += players[i].name + ' with ' + players[i].score + ' points.';

    app.ask(app.buildRichResponse() 
      .addSimpleResponse({speech: speechOutput, displayText: text})
      .addBasicCard(app.buildBasicCard(cardText))
      .addSuggestions(['Set everyone\'s score', 'Everyone gets points', 'Everyone loses points', 'Get help'])
    );
  }

  //adds a given amount of points to certain players or everyone
  function addPoints (app) {
    console.log('In add points function');
    if (noPlayersInGame(app)) {
      return;
    }
    
    //If players listed aren't found, warn that they weren't found and couldn't have points added to them
    //else if all goes well, just say "okay"
  }

  //removes a given amount of points from certain players or everyone
  function removePoints (app) {
    console.log('In remove points function');
    if (noPlayersInGame) {
      return;
    }
    //If players listed aren't found, warn that they weren't found and couldn't have points removed from them
    //else if all goes well, just say "okay"
  }

  //sets certain players or everyone's score to a certain value
  function setPoints (app) {
    console.log('In set points function');
    if (noPlayersInGame) {
      return;
    }
    
    //If players listed aren't found, warn that they weren't found and couldn't have had their scores set
    //else if all goes well, just say "okay"
  }

  //Ends the current game, declares a winner, and prompts to start a new game with the same players
  function endGame (app) {
    console.log('In end game function');
    if (playerMap.size === 0) {
      console.log('Ended game without adding any players, exiting');
      app.tell('Ok, come back soon to play a game');
    }
    
    //If yes, set everyone's score to zero and say "New game with NAME1, NAME2... started!"
    //otherwise exit conversation
  }

  let actionMap = new Map();
  actionMap.set('confirm.players', confirmPlayers);
  actionMap.set('add.players', addPlayers);
  actionMap.set('app_players.cancel', cancelAddPlayers);
  actionMap.set('list.players', listPlayers)
  actionMap.set('add.points', addPoints);
  actionMap.set('remove.points', removePoints);
  actionMap.set('set.points', setPoints);
  actionMap.set('end.game', endGame);
  app.handleRequest(actionMap);
};