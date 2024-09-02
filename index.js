const fs = require('fs');

const groups = JSON.parse(fs.readFileSync('groups.json'));
const exhibitions = JSON.parse(fs.readFileSync('exibitions.json'));

let allTeams = {};

const INDENTATION = " ".repeat(4);

const Utils = {
    // `>> 0` is a high performance truncating operation
    randomRange: (min, max) => (min + Math.random() * max),

    clamp: (min, val, max) => Math.max(min, Math.min(max, val)),

    matchPointsRange: function() {
        const MIN = 62;
        const MAX = 144;

        return {
            min: MIN + this.randomRange(0, 15) >> 0,
            max: MAX - this.randomRange(0, 15) >> 0
        }
    },

    breakTies: function(skipSort = false) {
        //let hasTies = false;
        for (let key in groups) {
            let group = groups[key];

            if (!skipSort) {
                group.sort((a, b) => allTeams[b.ISOCode].stats.points - allTeams[a.ISOCode].stats.points);
            }

            let tied = null, si = null;

            for (let i = 1, cur = allTeams[group[0].ISOCode].stats.points; i < group.length; i++) {
                let team = allTeams[group[i].ISOCode];

                if (team.stats.points === cur) {
                    if (!tied) {
                        tied = 1;
                        si = i - 1;
                    };
                    tied++;
                } else {
                    cur = team.stats.points;
                }
            }

            //console.log(tied);
            if (!tied) continue;
            hasTies = true;

            if (tied === 2) {
                let team1 = allTeams[group[2].ISOCode];
                let headToHead = team1.matches[group[3].ISOCode];
                //let team2 = allTeams[group[3].ISOCode];
                if (headToHead.opponent > headToHead.target) {
                    [group[2], group[3]] = [group[3], group[2]]
                }
            } else {
                let participants = (group.slice(si, si + tied)).map(i => i.ISOCode);
                let miniLeague = [];

                for (let i in participants) {
                    miniLeague[i] = [participants[i], 0];
                }

                for (let i = 0; i < participants.length - 1; i++) {
                    for (let j = i + 1; j < participants.length; j++) {
                        let match = allTeams[miniLeague[i][0]]?.matches[miniLeague[j][0]];
                        let iwin = match?.target > match?.opponent;

                        //console.log(miniLeague[i][0] + " against " + miniLeague[j][0])

                        miniLeague[i][1] += (1 + (+iwin));
                        miniLeague[j][1] += (1 + (+!iwin));
                    }
                }

                miniLeague.sort((a,b) => b[1] - a[1]);

                for (let i = si, j = 0; i < si + 3; i++, j++) {
                    let ind = group.findIndex(o => o.ISOCode === miniLeague[j][0]);
                    [group[i], group[ind]] = [group[ind], group[i]];
                }
            }

            //console.log(tied)
        }
    },

    fibaDifferenceProbability: function(target, opponent) {
        
        let FIBA_DIFFERENCE_DIVISOR = 110;

        if (allTeams[target] && allTeams[opponent]) {
            return 0.5 + ((allTeams[opponent].FIBA - allTeams[target].FIBA) / FIBA_DIFFERENCE_DIVISOR);
        }

        return 0.5;
    },

    winProbability: function(target, opponent, includeRandomFactor = true) {
        const RANDOM_FACTOR = 15; // in percents
        const FORM_DIVISOR = 150;

        const randomAddition = !includeRandomFactor ? 0 : (this.randomRange(-RANDOM_FACTOR, RANDOM_FACTOR * 2)) / 100;
        const targetBaseProbability = this.fibaDifferenceProbability(target, opponent);
        const formDifference = (allTeams[target].form.average - allTeams[opponent].form.average) / FORM_DIVISOR;
        
        //console.log(randomAddition)
        //console.log(`RA: ${randomAddition} | TBP: ${targetBaseProbability} | FD: ${formDifference}`)

        return this.clamp(0, (targetBaseProbability + formDifference + randomAddition), 1);
    },

    adjustTeamFormByMatch: function (target, team2, targetPoints, team2Points, includeForm = false) {
        let team1Odds = 0.5 + (includeForm ? this.winProbability(target, team2, false) : this.fibaDifferenceProbability(target, team2));
        //let team2Odds = includeForm ? this.winProbability(team2, target, false) : this.fibaDifferenceProbability(team2, target);

        let targetTeam = allTeams[target];
        let diff = (targetPoints - team2Points) * team1Odds;

        targetTeam.form.sum += diff;
        targetTeam.form.sumLen++;
        targetTeam.form.average = targetTeam.form.sum / targetTeam.form.sumLen;
    },

    /**
     * Plays match using probability functions inside Utils
     * Handles form recalculation
     * @param {String} team1 
     * @param {String} team2 
     * @returns {} {team1, team2}
     */
    playMatch: function(team1, team2) {
        const DISPARITY_FACTOR = 0.55;
        const DISPARITY_MULTIPLIER = 1 + (Utils.randomRange(-(DISPARITY_FACTOR * 100), (DISPARITY_FACTOR * 100) * 2) / 100);

        const team1Odds = this.winProbability(team1, team2);
        const team2Odds = this.winProbability(team2, team1);


        let matchPoints = this.matchPointsRange();
        let middle = (matchPoints.max - matchPoints.min) / 2;
        
        let team1Points = this.clamp(matchPoints.min, Math.round(matchPoints.min + middle * (team1Odds * DISPARITY_MULTIPLIER)), matchPoints.max) >> 0;
        let team2Points = this.clamp(matchPoints.min, Math.round(matchPoints.min + middle * (team2Odds * DISPARITY_MULTIPLIER)), matchPoints.max) >> 0;

        if (team1Points === team2Points) return this.playMatch(team1, team2);

        this.adjustTeamFormByMatch(team1, team2, team1Points, team2Points, true);
        this.adjustTeamFormByMatch(team2, team1, team2Points, team1Points, true);
        
        return {
            team1: team1Points,
            team2: team2Points
        }
    }
};

/**
 * Iterates over all the teams in groups.json for easier access
 * Calculates initial team form by the sum average of all friendly game point differences in exibitions.json
 */
const parseTeamsAndForm = () => {
    // iterating the arrays provided in groups.json
    for (let key of Object.keys(groups)) {

        // iterating the teams from each array
        for (let team of groups[key]) {
            let ISO = team.ISOCode;

            allTeams[ISO] = {
                FIBA: team.FIBARanking,
                ISO: ISO,
                name: team.Team,
                matches: {},
                stats: {
                    wins: 0,
                    losses: 0,
                    points: 0,
                    scoreSum: 0,
                    scoresAchieved: 0,
                    scoresTaken: 0,
                    pointDifference: 0
                },
                form: {
                    average: 0,
                    sum: 0,
                    sumLen: 0,
                }
            }
        }
    }

    // calculate forms for the first time
    for (let team of Object.keys(allTeams)) {

        for (let game of exhibitions[team]) {
            let points = game.Result.split("-")
            Utils.adjustTeamFormByMatch(team, game.Opponent, points[0], points[1], false);
        }
    }

}

const groupPhase = () => {
    let output = "";

    let groupMatches = {};

    // total of 6 games, they go by these indexes in order to disable teams from having 2 games in a row. specific to the output of the for loop matching pairs
    const pairs = [0, 5, 1, 4, 2, 3];

    for (const groupName in groups) {
        const teams = groups[groupName];
        groupMatches[groupName] = [];

        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                groupMatches[groupName].push([teams[i].ISOCode, teams[j].ISOCode]);
            }
        }
    }

    for (let i = 0; i < 3; i++) {
        output += "\nGrupna faza - " + ("I".repeat(i + 1)) + " kolo:\n";

        for (let group in groupMatches) {
            output += INDENTATION + "Grupa " + group + ":\n";

            for (let j = 0; j < 2; j++) {
                let startInd = i * 2;
                let currentPair = groupMatches[group][pairs[startInd + j]];

                let team1ISO = currentPair[0];
                let team2ISO = currentPair[1];

                let result = Utils.playMatch(team1ISO, team2ISO);

                let team1 = allTeams[team1ISO];
                let team2 = allTeams[team2ISO];

                team1.stats.scoreSum += result.team1;
                team2.stats.scoreSum += result.team2;

                team1.matches[team2ISO] = {target: result.team1, opponent: result.team2};
                team2.matches[team1ISO] = {target: result.team2, opponent: result.team1};

                // "+" is there to convert it into a number. 
                // ">>" truncates the number. 
                // typically, about 35% of points scored in a basketball game are three-pointers. to adjust for realism im making it a random percentage from 20 to 45. this can further be adjusted by looking at team 
                // statistics to figure out how likely it is for them to score three-pointers
                // let t1Scores = Utils.calculateScores(+result.team1, Utils.randomRange(20, 45) >> 0);
                // let t2Scores = Utils.calculateScores(+result.team2, Utils.randomRange(20, 45) >> 0);

                team1.stats.scoresAchieved += (+result.team1);
                team2.stats.scoresAchieved += (+result.team2);
                
                team1.stats.scoresTaken += (+result.team2);
                team2.stats.scoresTaken += (+result.team1);
                
                team1.stats.pointDifference = (team1.stats.scoresAchieved - team1.stats.scoresTaken);
                team2.stats.pointDifference = (team2.stats.scoresAchieved - team2.stats.scoresTaken);

                // the "+" converts the boolean into a number. 0 for false, 1 for true;
                let team1Status = +(result.team1 > result.team2), team2Status = +(result.team2 > result.team1);

                // given the comment above, this adds 1 if the team won and 0 if it lost
                team1.stats.wins += team1Status;
                team2.stats.wins += team2Status;

                // same thing, but flipped. 0 if it won, 1 if it lost
                team1.stats.losses += +!team1Status;
                team2.stats.losses += +!team2Status;

                // since 1 point is for loss and 2 is for win, it boils down to 1 + teamStatus
                team1.stats.points += (1 + team1Status);
                team2.stats.points += (1 + team2Status);

                output += INDENTATION.repeat(2);
                output += (team1.name + " - " + team2.name + " (" + result.team1 + ":" + result.team2 + ")\n");
            }
        }
    }

    console.log(output + "\n");
    Utils.breakTies();


    let final = "Konačan plasman u grupama:\n";

    for (let group in groups) {
        final += INDENTATION + "Grupa " + group + " (Ime - pobede/porazi/bodovi/postignuti koševi/primljeni koševi/koš razlika):\n"


        for (let ind in groups[group]) {
            let team = groups[group][ind];
            //console.log(allTeams[team.ISOCode])
            let stats = allTeams[team.ISOCode].stats;

            final += INDENTATION.repeat(2) + (+ind + 1) + ". " + (team.Team.padEnd(20, " ")) + stats.wins + " / " + stats.losses + " / " + stats.points + " / " + stats.scoresAchieved + " / " + stats.scoresTaken + " / " + (stats.pointDifference) + "\n"
        }
    }

    console.log(final);
}

const decideHats = () => {
    let firstPlaceTeams = [];
    let secondPlaceTeams = [];
    let thirdPlaceTeams = [];

    for (let key in groups) {
        let group = groups[key];
        firstPlaceTeams.push(allTeams[group[0].ISOCode]);
        secondPlaceTeams.push(allTeams[group[1].ISOCode]);
        thirdPlaceTeams.push(allTeams[group[2].ISOCode]);
    }

    const sortTeams = (teams) => teams.sort((a, b) => {
        if (b.stats.points !== a.stats.points) return b.stats.points - a.stats.points;
        if (b.stats.pointDifference !== a.stats.pointDifference) return b.stats.pointDifference - a.stats.pointDifference;
        return b.stats.scoresAchieved - a.stats.scoresAchieved;
    });


    firstPlaceTeams = sortTeams(firstPlaceTeams);
    secondPlaceTeams = sortTeams(secondPlaceTeams);
    thirdPlaceTeams = sortTeams(thirdPlaceTeams);

    const rankedTeams = [
        ...firstPlaceTeams.map((team, index) => ({ ...team, rank: index + 1 })),
        ...secondPlaceTeams.map((team, index) => ({ ...team, rank: index + 4 })),
        ...thirdPlaceTeams.map((team, index) => ({ ...team, rank: index + 7 }))
    ];

    const hats = "DEFG".split("");

    let log = "\nŠeširi:\n";

    for (let i = 0; i < rankedTeams.length - 1; i+=2) {
        let hat = hats[(i / 2) >> 0];

        rankedTeams[i].hat = hat;

        log += INDENTATION + "Šešir " + hat + ":\n";
        log += INDENTATION.repeat(2) + rankedTeams[i].name + "\n";
        log += INDENTATION.repeat(2) + rankedTeams[i + 1].name + "\n";
    }

    console.log(log)
    return rankedTeams;
}

// teams are sorted accordint to hats. 0-1 - Hat D. 2-3 - Hat E...
const finals = (teams) => {
    // which indexes the D and E hats can pick from
    const quarterOptions = {
        "DG": [[0,1],[6,7]],
        "EF": [[2,3],[4,5]]
    }

    const quarterMatchups = [];
    let eliminationString = "\nEliminaciona faza:\n"

    for (let key in quarterOptions) {
        let opts = quarterOptions[key];

        let teamIndex = 0;
        let randomPick = (Math.random() * 2) >> 0;

        let team1 = teams[opts[0][teamIndex]];
        let team2 = teams[opts[1][randomPick]];

        let team3 = teams[opts[0][teamIndex + 1]];
        let team4 = teams[opts[1][+!randomPick]];

        // if they matched up previously
        if (team1.matches[team2.ISO]) {
            // randomPick initially gets 0 or 1 as index, this just flips it
            team2 = teams[opts[1][+!randomPick]];
            team4 = teams[opts[1][randomPick]];
            
            quarterMatchups.push({team1: team1.ISO, team2: team2.ISO, hat: key});
            quarterMatchups.push({team1: team3.ISO, team2: team4.ISO, hat: key});
        } else {
            quarterMatchups.push({team1: team1.ISO, team2: team2.ISO, hat: key});
            quarterMatchups.push({team1: team3.ISO, team2: team4.ISO, hat: key});
        }

        eliminationString += INDENTATION + team1.name + " - " + team2.name + "\n";
        eliminationString += INDENTATION + team3.name + " - " + team4.name + "\n";
    
        eliminationString += "\n";
    }

    console.log(eliminationString);

    let quartString = "Četvrtfinale:\n";
    let semiMatchups = [], quartWinners = [];

    quarterMatchups.map(({team1, team2, hat}) => {
        let results = Utils.playMatch(team1, team2);
        quartString += INDENTATION + allTeams[team1].name + " - " + allTeams[team2].name + " (" + results.team1 + ":" + results.team2 + ")\n";

        let addTeam = {hat, ...(results.team1 > results.team2) ? teams.find(o => o.ISO === team1) : teams.find(o => o.ISO === team2)}
        quartWinners.push(addTeam);
        return results;
    })

    console.log(quartString);

    let semiMatchup1 = quartWinners.findIndex(obj => obj.hat !== quartWinners[0].hat);
    semiMatchups.push({team1: quartWinners[0], team2: quartWinners[semiMatchup1]});
    
    if (semiMatchup1 === 1) {
        semiMatchups.push({team1: quartWinners[2], team2: quartWinners[3]});
    } else semiMatchups.push({team1: quartWinners[1], team2: quartWinners[semiMatchup1 === 3 ? 4 : 3]});


    let semiString = "Polufinale:\n";
    let thirdMatchup = [], finalMatchup = [];

    for (let match of semiMatchups) {
        let results = Utils.playMatch(match.team1.ISO, match.team2.ISO);

        semiString += INDENTATION + match.team1.name + " - " + match.team2.name + " (" + results.team1 + ":" + results.team2 + ")\n";

        let didTeam1Win = results.team1 > results.team2;

        thirdMatchup.push(didTeam1Win ? match.team2 : match.team1);
        finalMatchup.push(didTeam1Win ? match.team1 : match.team2);
    }

    console.log(semiString);

    let medals = [];

    let thirdResults = Utils.playMatch(thirdMatchup[0].ISO, thirdMatchup[1].ISO);
    console.log("Utakmica za treće mesto:\n" + 
        INDENTATION + thirdMatchup[0].name + " - " + thirdMatchup[1].name + " (" + thirdResults.team1 + ":" + thirdResults.team2 + ")\n"
    )
    medals.push(thirdResults.team1 > thirdResults.team2 ? thirdMatchup[0] : thirdMatchup[1]);
    
    let finalsResults = Utils.playMatch(finalMatchup[0].ISO, finalMatchup[1].ISO);
    console.log("Finale:\n" + 
        INDENTATION + finalMatchup[0].name + " - " + finalMatchup[1].name + " (" + finalsResults.team1 + ":" + finalsResults.team2 + ")\n"
    )
    medals.unshift(finalsResults.team1 > finalsResults.team2 ? finalMatchup[1] : finalMatchup[0]);
    medals.unshift(finalsResults.team1 > finalsResults.team2 ? finalMatchup[0] : finalMatchup[1]);

    console.log("Medalje:\n" +
        INDENTATION + "1. " + medals[0].name + "\n" +
        INDENTATION + "2. " + medals[1].name + "\n" +
        INDENTATION + "3. " + medals[2].name + "\n"
    )

    
    //console.log(semiMatchups)

}

const main = () => {
    parseTeamsAndForm();
    groupPhase();
    // * decideHats also logs
    let hats = decideHats();
    finals(hats);
};
main();
