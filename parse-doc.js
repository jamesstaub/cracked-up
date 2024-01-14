// This is a script to parse the js docs into a format that can be used in Euclip's Codemirror autocomplete config
// run:  node parse-doc.js ./dist/cracked.js > out.txt

/**
 * TODO: adapt this service for use with custom user macros such as channelStrip.
 * if a macro is declared in a cracked scrip with jsdocs this script should run serverside and
 * update the autocomplete config (which should also move to serverside/compressed formats probably)
 * this script should move out of cracked repo and into back end repo 
 */
const fs = require("fs");
const { parse, getCommentsFromFile } = require("jsdoc-parse-plus");
const util = require("util");

const filePath = process.argv[2];

// takes array of js-doc comment strings
function parseDistFile(comments) {
  let parsed = comments
    .map((c) => {
      return parse(c);
    })
    .filter((c) => {
      return c.category?.value; // exclude miscellanious comments in the code
    })
    .map((c) => {
      //       category, description, param, constructor, private, type
      let name = c.name?.value;
      let category = c.category?.value;
      let desc = c.description?.value;
      let memberOf = c.memberOf?.value;

      let params = c.param?.map((p) => {
        return {
          name: p.name,
          type: p.type,
          description: p.description,
          optional: p.optional,
          defaultValue: p.defaultValue,
        };
      });
      return {
        category,
        name: name?.split("#").pop() || name,
        desc,
        memberOf,
        params,
      };
    });
  return parsed;
}

function createObjectOptions(parsedDocs) {
  return parsedDocs.map((doc) => {
    // category
    // name
    // desc
    // params
    let boost = 0;
    let category = doc.category;

    switch (doc.category) {
      case "Debug":
        boost = -50;
        break;
      case "Find":
        boost = -10;
        break;
      case "Node":
        boost = 20;
        break;
      case "Midi":
        boost = 30;
        break;
      case "Connect":
        boost = 50;
        break;
      case "Algorithmic":
        boost = 60;
        break;
      case "Delay":
        boost = 80;
        break;
      case "Distortion":
        boost = 85;
        break;
      case "Filter":
        boost = 90;
        break;
      default:
        break;
    }

    if (doc.name == 'sampler') {
      boost = 99
      category = 'Sampler' // overwrite from misc for better sorting in autocomplete
    }

    return {
      label: doc.name,
      type: category,  
      detail: doc.desc,
      boost: boost
    }
  })
}

function createParamOptions(parsedDocs) {
  // This script turns the params from cracked modules into codemirror autocomplete Completion options
  const paramOptions = {};
  parsedDocs
    .filter((d) => d.params)
    .forEach((d) => {
      console.log(d);
      if (!paramOptions[d.name]) {
        paramOptions[d.name] = [];
      }

      d.params.forEach((p) => {
        if (p.type == "Object") {
          return; // skip "userParam object args"
        }
        // handle cases like userParm.path
        paramOptions[d.name].push({
          label: p.name,
          type: p.type,
          detail: p.description,
          defaultValue: p.defaultValue
        });
      });
    });
  return paramOptions;
}


fs.readFile(filePath, "utf8", (err, data) => {
  if (err) {
    console.error(err);
    return;
  }
  const fileContent = data;
  const comments = getCommentsFromFile(fileContent);
  const parsed = parseDistFile(comments);
  const objectOptions = createObjectOptions(parsed);
  const params = createParamOptions(parsed)
  console.log(
    "const objectCompletions = ",
    util.inspect(objectOptions, {
      showHidden: false,
      depth: 4,
      maxArrayLength: null,
    })
  );
  console.log(
    "const argCompletions = ",
    util.inspect(params, { showHidden: false, depth: 4, maxArrayLength: null })
  );

});

// TODO:
// update cracked js docs so @params have description strings (cant seem to parse otherwise)
// re-build cracked source
// add parse-doc as a grunt task!
// add `boost` param in function to generate based on category
// {label: 'pink',
//     type: 'Noise',
//     boost: 70,
//     detail: 'Pink Noise\n\n[See more noise examples](examples/noise.html)'}

