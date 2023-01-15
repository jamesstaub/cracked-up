const fs = require("fs");
const { parse, getCommentsFromFile } = require("jsdoc-parse-plus");
const util = require("util");

const filePath = process.argv[2];

fs.readFile(filePath, "utf8", (err, data) => {
  if (err) {
    console.error(err);
    return;
  }
  const fileContent = data;
  const comments = getCommentsFromFile(fileContent);
  
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
      name,
      desc,
      memberOf,
      params,
    };
  });
  console.log(util.inspect(parsed, {showHidden: false, depth: 4}));
});


// TODO: 
// update cracked js docs to @params have description strings (cant seem to parse otherwise)
// re-build cracked source 
// add parse-doc as a grunt task!
// add `boost` param in function to generate based on category
// {label: 'pink',
//     type: 'Noise',
//     boost: 70,
//     detail: 'Pink Noise\n\n[See more noise examples](examples/noise.html)'}