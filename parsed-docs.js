// run:  node parse-doc.js ./dist/cracked.js > out.txt
let docs = [
  {
    category: "Find",
    desc: 'Updates the internal selected nodes array with a collection of audio nodes matching the selector provided. Type, Class & Id selectors are supported.\n<pre>\n<code>//type selector using the node name, sets the frequency for all sines\n__("sine").frequency(200);\n\n//set the frequency for the node with id "foo"\n__("#foo").frequency(200);\n\n//set the frequency for any nodes with a class of "bar"\n__(".bar").frequency(200);\n\n//select all sines, any nodes with classname "bar" or id of "foo"\n//and set their frequencies to 200\n__("sine,.bar,#foo").frequency(200);</code></pre>\n\n[See more selector examples](examples/selector.html)\n\nIf invoked without arguments, cracked() resets the selection/connection state, removing any record of previous nodes and effectively marking the start of a new connection chain. Since a new node will try to connect to any previous node, calling __() tells a node that there is no previous node to connect to.\nFor example:\n<pre>\n<code>//Create & connect sine -> lowpass -> dac\n__().sine();\n__.lowpass();\n__.dac();\n\n//Create but don\'t connect\n__().sine();\n__().lowpass();\n__().dac();</code></pre>\n\ncracked is also the namespace for public methods and also can be written as a\ndouble underscore __\n<pre>\n<code>__("sine"); //same as cracked("sine")</code>\n</pre>',
    params: [
      {
        name: "selector",
        type: "String",
        description: "selector expression",
        optional: true,
      },
    ],
  },
  {
    category: "Find",
    name: "cracked#reset",
    desc: "resets everything to its initial state\n<pre><code>//reset state for the entire app\ncracked.reset();</code></pre>",
  },
  {
    category: "Find",
    name: "cracked#exec",
    desc: 'executes a method with a specific set of selected nodes without modifying the internal selectedNodes array\n<pre><code>//filter everything but the sines from currently selected nodes and\n//execute the frequency method against the remaining sines.\n//the internal _selectedNodes array remains unchanged\ncracked.exec(\n"frequency",\n200,\ncracked.filter("sine")\n);</code></pre>',
    params: [
      {
        name: "method",
        type: "String",
        description: "method name",
        optional: false,
      },
      {
        name: "args",
        type: "Array",
        description: "arguments to supply to the method",
        optional: false,
      },
      {
        name: "nodes",
        type: "Array",
        description: "node array to execute against",
        optional: false,
      },
    ],
  },
  {
    category: "Find",
    name: "cracked#each",
    desc: "iterate over the selectedNodes array, executing the supplied function for each element\n<pre><code>__.each(type, function(node,index,array){\n//Loops over any selected nodes. Parameters are the\n//current node, current index, and the selectedNode array\n});</code></pre>",
    params: [
      {
        name: "type",
        type: "String",
        description: "string to be checked against the node type",
        optional: false,
      },
      {
        name: "fn",
        type: "Function",
        description: "function to be called on each node",
        optional: false,
      },
    ],
  },
  {
    category: "Find",
    name: "cracked#filter",
    desc: 'Filter selected nodes with an additional selector returns node array that can used with exec()\n<pre><code>//select any sine & sawtooth oscillators\n__("sine,saw");\n\n//filter out everything but the sines and\n//execute the frequency method against those nodes.\n//the internal _selectedNodes array remains unchanged\ncracked.exec(\n"frequency",\n200,\ncracked.filter("sine")\n);</code></pre>',
    params: [
      {
        name: "selector",
        type: "String",
        description: "selector expression",
        optional: false,
      },
    ],
  },
  {
    category: "Find",
    name: "cracked#find",
    desc: 'Find nodes with a selector returns node array that can used with exec()\n<pre><code>//find all the sines in the patch and\n//execute the frequency method against those nodes.\n//the internal _selectedNodes array remains unchanged\ncracked.exec(\n"frequency",\n200,\ncracked.find("sine")\n);</code></pre>',
    params: [
      {
        name: "selector",
        type: "String",
        description: "selector expression",
        optional: false,
      },
    ],
  },
  {
    category: "Control",
    name: "cracked#start",
    desc: 'Calls start() on the currently selected nodes. Throws no error if there aren\'t any selected nodes with a start method\n<pre><code>//create and connect sine->lowpass->dac\n__().sine().lowpass().dac();\n//start the sine node\n__("sine").start();</code></pre>\n\n[See more control examples](examples/control.html)',
  },
  {
    category: "Control",
    name: "cracked#stop",
    desc: 'Calls stop() on the currently selected nodes. Throws no error if there are no selected nodes that have a stop method.\n<pre><code>//create and connect sine->lowpass->dac\n__().sine().lowpass().dac();\n//stop the sine node\n__("sine").stop();</code></pre>\n\n[See more control examples](examples/control.html)',
  },
  {
    category: "Control",
    name: "cracked#ramp",
    desc: 'Public method to ramp a parameter on currently selected nodes. Target & timeToRamp parameters can be numbers or arrays of numbers for multisegement ramps. Initial value param is optional, if omitted, then the current value is used as the initial value. If loop is running, then ramp start times are snapped to the sequencer grid.\n<pre><code>//create and connect sine->lowpass->dac & play\n__().sine().lowpass().dac().play();\n//ramp the frequency of the sine. 220 to 880 in 5 seconds\n__("sine").ramp(880,5,"frequency",220);</code></pre>\n\n[See more envelope examples](examples/envelopes.html)',
    params: [
      {
        name: "target",
        type: "Number|Array",
        description: "value to ramp to",
        optional: false,
      },
      {
        name: "timeToRamp",
        type: "Number|Array",
        description: "length of ramp in seconds",
        optional: false,
      },
      {
        name: "paramToRamp",
        type: "String",
        description: "name of parameter to ramp",
        optional: false,
      },
      {
        name: "initial",
        type: "Number",
        description: "value to start the ramp at",
        optional: false,
      },
      {
        name: "type",
        type: "String",
        description: 'of ramp, "exp" is exponential. defaults to linear.',
        optional: false,
      },
    ],
  },
  {
    category: "Control",
    name: "cracked#attr",
    desc: 'Set or get attribute values on a node. Takes an object with\nany number of key:value pairs to set. A string with the param\nname returns the current value of that param on the first selected\nnode.\n\n<pre><code>//create and connect sine->lowpass->dac & play\n__().sine().lowpass().dac().play();\n//set the frequency of the sine to 880\n__("sine").attr({"frequency":880});\n\n//get the frequency\n__("sine").attr("frequency"); //880</code></pre>\n\n[See more control examples](examples/control.html)',
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "options object",
        optional: false,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#script",
    desc: "Native Script node",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#waveshaper",
    desc: "Native Waveshaper",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#compressor",
    desc: "Native Compressor",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "userParams.threshold",
        type: "Number",
        description: "in decibels, nominal range of -100 to 0.",
        optional: true,
        defaultValue: "-24",
      },
      {
        name: "userParams.knee",
        type: "Number",
        description: "in decibels, range of 0 to 40",
        optional: true,
        defaultValue: "30",
      },
      {
        name: "userParams.ratio",
        type: "Number",
        description: "nominal range of 1 to 20",
        optional: true,
        defaultValue: "12",
      },
      {
        name: "userParams.attack",
        type: "Number",
        description: "time in seconds, nominal range of 0 to 1",
        optional: true,
        defaultValue: "0.003",
      },
      {
        name: "userParams.release",
        type: "Number",
        description: "time in seconds, nominal range of 0 to 1",
        optional: true,
        defaultValue: "0.250",
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#gain",
    desc: "Native Gain",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "userParams.threshold",
        type: "Number",
        description: "in decibels, nominal range of -100 to 0.",
        optional: true,
        defaultValue: "-24",
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#native_delay",
    desc: 'Naming this with prefix native so I can use "delay" as a plugin name\nmax buffer size three minutes',
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "userParams.delay",
        type: "Number",
        description: "in seconds.",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#osc",
    desc: "Native oscillator, used the oscillator plugins",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#biquadFilter",
    desc: "Native biquad filter, used by filter plugins",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#channelMerger",
    desc: "Native channelMerger",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#channelSplitter",
    desc: "Native channelSplitter",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#convolver",
    desc: "Native convolver, used by reverb",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "userParams.path",
        type: "String",
        description: "path to remote impulse",
        optional: true,
      },
      {
        name: "userParams.fn",
        type: "Function",
        description: "function to generate impulse",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#stereoPanner",
    desc: "Native stereo panner, used by panner",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#destination",
    desc: "Native destination, used by the dac plugin",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Node",
    name: "cracked#origin",
    desc: "Native sound input node, used by the adc plugin\norigin = opposite of destination",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Sequence",
    name: "cracked#loop",
    desc: 'main method for loop\n\n<pre><code>//configure the loop: 8 steps, 100ms between steps\n__.loop({steps:8,interval:100});\n\n//start\n__.loop("start");\n//stop\n__.loop("stop");\n//reset the loop params\n__.loop("reset");</code></pre>\n\n[See sequencing examples](examples/sequencing.html)',
    params: [
      {
        name: "arg",
        type: "String",
        description: "stop/start/reset commands",
        optional: true,
      },
      {
        name: "config",
        type: "Object",
        description: "configuration object",
        optional: true,
      },
      {
        name: "config.interval",
        type: "Number",
        description: "step length in ms",
        optional: true,
        defaultValue: "100",
      },
    ],
  },
  {
    category: "Sequence",
    name: "cracked#bind",
    desc: "Listener - binds a set of audio nodes and a callback to loop step events",
    params: [
      {
        name: "eventType",
        type: "String",
        description: 'currently just "step"',
        optional: false,
      },
      {
        name: "fn",
        type: "Function",
        description: "callback to be invoked at each step",
        optional: false,
      },
      {
        name: "data",
        type: "Array",
        description: "should the same length as the number of steps",
        optional: false,
      },
    ],
  },
  {
    category: "Sequence",
    name: "cracked#unbind",
    desc: "Remove any steps listeners registered on these nodes",
  },
  {
    category: "Macro",
    name: "cracked#begin",
    desc: 'start macro recording, add any user parameters (id,classname,etc) to the container macro\n<pre><code>//define a simple macro named "microsynth"\n__().begin("microsynth").sine().gain(0).dac().end("microsynth");</code></pre>',
    params: [
      {
        name: "name",
        type: "String",
        description: "macro name",
        optional: false,
      },
      {
        name: "userParams",
        type: "Object",
        description: "options object",
        optional: false,
      },
    ],
  },
  {
    category: "Macro",
    name: "cracked#end",
    desc: 'end macro recording\n<pre><code>//define a simple macro named "microsynth"\n__().begin("microsynth").sine().gain(0).dac().end("microsynth");</code></pre>',
    params: [
      {
        name: "name",
        type: "String",
        description: "macro name",
        optional: false,
      },
    ],
  },
  {
    category: "Midi",
    name: "cracked#midi_supported",
    desc: "Is midi supported?\n<pre><code>if(__.midi_supported()) {\n//do midi stuff here\n//cuz you can\n}</code></pre>",
  },
  {
    category: "Midi",
    name: "cracked#midi_init",
    desc: "Initialize midi. Callback is invoked when ready.\n<pre><code>//when midi is ready...\n__.midi_init(function(){\n//...call this function\n});</code></pre>",
  },
  {
    category: "Midi",
    name: "cracked#midi_receive",
    desc: "Midi input. Bind handler for the onMIDIMessage event.\n<pre><code>//when midi is ready...\n__.midi_init(function(){\n__.midi_receive(function(midiEvent){\n//handle incoming raw midi events here...\n});\n});</code></pre>",
  },
  {
    category: "Midi",
    name: "cracked#midi_noteon",
    desc: "Midi input. Shorthand binding for note ons\n<pre><code>//when midi is ready...\n__.midi_init(function(){\n//get midi noteon events\n__.midi_noteon(function(noteData){\n//note data = [status,pitch,velocity]\n//handle midi note ons...\n});\n});</code></pre>",
  },
  {
    category: "Midi",
    name: "cracked#midi_noteoff",
    desc: "Midi input. Shorthand binding for note offs\n<pre><code>//when midi is ready...\n__.midi_init(function(){\n//get midi noteoff events\n__.midi_noteoff(function(noteData){\n//note data = [status,pitch,velocity]\n//handle midi note offs...\n});\n});</code></pre>",
  },
  {
    category: "Midi",
    name: "cracked#midi_control",
    desc: "Midi input. Shorthand binding for midi control messages\n<pre><code>//when midi is ready...\n__.midi_init(function(){\n//get midi control events\n__.midi_control(function(noteData){\n//note data = [status,pitch,velocity]\n//handle midi control events...\n});\n});</code></pre>",
  },
  {
    category: "Connect",
    name: "cracked#connect",
    desc: 'chainable method to connect nodes to previously instantiated nodes. Takes a selector to find the nodes to connect to.\n<pre><code>//create and connect sine->lowpass->dac\n__().sine().lowpass().dac();\n//create a sawtooth and connect to the lowpass instantiated above\n__().saw().connect("lowpass");</code></pre>',
    params: [
      {
        name: "selector",
        type: "String",
        description: "selector expression",
        optional: false,
      },
    ],
  },
  {
    category: "Connect",
    name: "cracked#remove",
    desc: 'chainable method to stop, disconnect and remove the currently selected nodes. Takes a time in ms to schedule the node removal.\n<pre><code>//create and connect sine->lowpass->dac\n__().sine().lowpass().dac();\n//remove the lowpass instantiated above in 100ms\n__("lowpass").remove(100);</code></pre>',
    params: [
      {
        name: "time",
        type: "Number",
        description: "in ms to schedule node removal",
        optional: false,
      },
    ],
  },
  {
    category: "Debug",
    name: "cracked#log",
    desc: 'log selected nodes to console if any.\n<pre><code>//create and connect sine -> lowpass -> dac\n__().sine().lowpass().dac();\n\n//logs the [oscillatorNode] object to the console\n__("sine").log()</code></pre>',
  },
  {
    category: "Debug",
    name: "cracked#size",
    desc: 'return the length of selected nodes array\n<pre><code>//create and connect sine -> lowpass -> dac\n__().sine().lowpass().dac();\n\n//returns 2\n__("sine,lowpass").size();</code></pre>',
  },
  {
    category: "Debug",
    name: "cracked#_dumpState",
    desc: "dump the node lookup object to the console\nworks in debug only",
  },
  {
    category: "Debug",
    name: "cracked#_getNode",
    desc: "debug method to get a node with a uuid\nworks in debug only",
  },
  {
    category: "Debug",
    name: "cracked#_getNodeLookup",
    desc: "debug method to get all nodes",
  },
  {
    category: "Debug",
    name: "cracked#_setNodeLookup",
    desc: "debug method to set node UUIDs for a selector in the nodeLookup object.",
  },
  {
    category: "Type",
    name: "cracked#ifUndef",
    desc: "Returns the 2nd argument if the 1st is undefined",
    params: [
      {
        name: "test",
        type: "*",
        description: "thing to test for undefined",
        optional: false,
      },
      {
        name: "def",
        type: "*",
        description: "default value to return if test is undefined",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isNotUndef",
    desc: "Returns true if not undefined",
    params: [
      {
        name: "test",
        type: "*",
        description: "thing to test for undefined",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isUndef",
    desc: "Returns true if undefined",
    params: [
      {
        name: "test",
        type: "*",
        description: "thing to test for undefined",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isObj",
    desc: "Returns true if param is an object",
    params: [
      {
        name: "obj",
        type: "*",
        description: "thing to test",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isNum",
    desc: "Returns true if param is a number",
    params: [
      {
        name: "num",
        type: "*",
        description: "thing to test",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isStr",
    desc: "Returns true if param is a string",
    params: [
      {
        name: "str",
        type: "*",
        description: "thing to test",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isArr",
    desc: "Returns true if param is an array",
    params: [
      {
        name: "arr",
        type: "*",
        description: "thing to test",
        optional: false,
      },
    ],
  },
  {
    category: "Type",
    name: "cracked#isFun",
    desc: "Returns true if param is a function",
    params: [
      {
        name: "fn",
        type: "*",
        description: "thing to test",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#random_interval",
    desc: "execute a callback at random intervals within a range",
    params: [
      {
        name: "callback",
        type: "Function",
        description: "to be invoked at every interval",
        optional: false,
      },
      {
        name: "minTime",
        type: "Number",
        description: "minimum value for the random interval",
        optional: false,
      },
      {
        name: "maxTime",
        type: "Number",
        description: "maximum value for the random interval",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#random_envelope",
    desc: "create a adsr envelope with random values scaled to a length",
    params: [
      {
        name: "length",
        type: "Number",
        description: "in sec",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#fill_array",
    desc: "fill an array with some values",
    params: [
      {
        name: "size",
        type: "Number",
        description: "of the array to be filled",
        optional: false,
      },
      {
        name: "fn",
        type: "Function",
        description:
          "to provide the value, if absent then array is filled with 0's.",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#array_next",
    desc: "advance thru array one step at a time.\nstart over when arriving at the end",
    params: [
      {
        name: "arr",
        type: "Array",
        description: "to loop over",
        optional: false,
      },
      {
        name: "offset",
        type: "Number",
        description: "added to index",
        optional: false,
      },
      {
        name: "limit",
        type: "Number",
        description: "upper bound to iteration",
        optional: false,
      },
      {
        name: "callback",
        type: "Function",
        description: "invoked when the count resets",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#chance",
    desc: "Returns a boolean based on percentage.",
  },
  {
    category: "Algorithmic",
    name: "cracked#scales",
    desc: "Returns a musical scale/mode based on type",
    params: [
      {
        name: "type",
        type: "String",
        description: "scale type",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#chords",
    desc: "Returns a musical scale/mode based on type",
    params: [
      {
        name: "type",
        type: "String",
        description: "scale type",
        optional: false,
      },
    ],
  },
  {
    category: "Algorithmic",
    name: "cracked#random_scale",
    desc: "Return a random series of frequencies from randomly selected octaves from a given scale",
  },
  {
    category: "Algorithmic",
    name: "cracked#random_arpeggio",
    desc: "Return a random series of frequencies from a randomly selected octave from a given chord",
  },
  {
    category: "Algorithmic",
    name: "cracked#shuffle",
    desc: "Takes a reference to an array, shuffles it\nand returns it",
  },
  {
    category: "Algorithmic",
    name: "cracked#random",
    desc: "Returns a random number between min & max",
  },
  {
    category: "Algorithmic",
    name: "cracked#throttle_factory",
    desc: "Factory to create a throttling function that returns true when called every nth times",
  },
  {
    category: "Algorithmic",
    name: "cracked#sequence_factory",
    desc: "Factory to create a sequencing function that returns true when called every nth times",
  },
  {
    category: "Algorithmic",
    name: "cracked#sequence",
    desc: "Sequence - create a series of steps that take a function to execute and a time in minutes for when to execute it\n\n[See more sampler examples](examples/sequence.html)",
    params: [
      {
        name: "name",
        type: "String",
        description: "name of sequence",
        optional: false,
      },
    ],
  },
  {
    category: "Delay",
    name: "cracked#reverb",
    desc: "Convolver Reverb\n\n[See more reverb examples](examples/delay.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.reverse",
        type: "Boolean",
        description: "reverse reverb",
        optional: true,
        defaultValue: "false",
      },
      {
        name: "params.path",
        type: "String",
        description: "path to impulse file. if no path, impulse is generated.",
        optional: true,
      },
      {
        name: "params.seconds",
        type: "Number",
        description: "if generated impulse, length in seconds.",
        optional: true,
        defaultValue: "3",
      },
      {
        name: "params.decay",
        type: "Number",
        description: "if generated impulse, length of decay in seconds",
        optional: true,
        defaultValue: "2",
      },
      {
        name: "params.fn",
        type: "Function",
        description: "custom function to generate an impulse buffer",
        optional: true,
        defaultValue: "buildImpulse",
      },
    ],
  },
  {
    category: "Delay",
    name: "cracked#delay",
    desc: "Delay\n\n[See more delay examples](examples/delay.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.delay",
        type: "Number",
        description: "delay time in seconds",
        optional: true,
        defaultValue: "1",
      },
      {
        name: "params.damping",
        type: "Number",
        description: "feedback input gain",
        optional: true,
        defaultValue: "0.84",
      },
      {
        name: "params.cutoff",
        type: "Number",
        description: "frequency of lowpass filtering on feedback loop",
        optional: true,
        defaultValue: "1500",
      },
      {
        name: "params.feedback",
        type: "Number",
        description: "feedback gain output",
        optional: true,
        defaultValue: "0.5",
      },
    ],
  },
  {
    category: "Delay",
    name: "cracked#comb",
    desc: "Comb\n\n[See more reverb examples](examples/delay.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.delay",
        type: "Number",
        description: "delay time in seconds",
        optional: true,
        defaultValue: "0.027",
      },
      {
        name: "params.damping",
        type: "Number",
        description: "feedback input gain",
        optional: true,
        defaultValue: "0.84",
      },
      {
        name: "params.cutoff",
        type: "Number",
        description: "frequency of lowpass filtering on feedback loop",
        optional: true,
        defaultValue: "3000",
      },
      {
        name: "params.feedback",
        type: "Number",
        description: "feedback gain output",
        optional: true,
        defaultValue: "0.84",
      },
    ],
  },
  {
    category: "Distortion",
    name: "cracked#bitcrusher",
    desc: "Bitcrusher\n\n[See more bitcrusher examples](examples/distortion.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Distortion",
    name: "cracked#ring",
    desc: "Ring Modulator\n\n[See more ring modulator examples](examples/distortion.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Distortion",
    name: "cracked#overdrive",
    desc: "Overdrive, waveshaper with additional parameters\n\n[See more overdrive examples](examples/distortion.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Envelope",
    name: "cracked#adsr",
    desc: "Attack Decay Sustain Release envelope\n\n[See more adsr examples](examples/envelopes.html)\n\nAttack time is the time taken for initial run-up of level from nil to peak, beginning when the key is first pressed.\nDecay time is the time taken for the subsequent run down from the attack level to the designated sustain level.\nSustain level is the level during the main sequence of the sound's duration, until the key is released.\nRelease time is the time taken for the level to decay from the sustain level to zero after the key is released.",
    params: [
      {
        name: "userParams",
        type: "Array",
        description: "5 values: attack,decay,sustain,hold,release",
        optional: true,
      },
      {
        name: "",
        type: "Array",
        description: "[userParams] 4 values: attack,decay,sustain,release",
        optional: false,
      },
      {
        name: "userParams",
        type: "Array",
        description: "3 values: attack,decay,sustain (holds until released)",
        optional: true,
      },
      {
        name: "userParams",
        type: "String",
        description: '"slow" or "fast"',
        optional: true,
      },
      {
        name: "userParams",
        type: "Number",
        description: "length of the total envelope",
        optional: true,
        defaultValue: "0.5",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#lowpass",
    desc: "Lowpass Filter\n\n[See more lowpass examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#highpass",
    desc: "Highpass Filter\n\n[See more highpass examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#bandpass",
    desc: "Bandpass Filter\n\n[See more bandpass examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#lowshelf",
    desc: "Lowshelf Filter\n\n[See more lowshelf examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
      {
        name: "params.gain",
        type: "Number",
        description: "gain",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#highshelf",
    desc: "Highshelf Filter\n\n[See more highshelf examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
      {
        name: "params.gain",
        type: "Number",
        description: "gain",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#peaking",
    desc: "Peaking Filter\n\n[See more peaking examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
      {
        name: "params.gain",
        type: "Number",
        description: "gain",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#notch",
    desc: "Notch Filter\n\n[See more notch examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Filter",
    name: "cracked#allpass",
    desc: "Allpass Filter\n\n[See more allpass examples](examples/filters.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "params.frequency",
        type: "Number",
        description: "frequency",
        optional: true,
        defaultValue: "440",
      },
      {
        name: "params.q",
        type: "Number",
        description: "Q",
        optional: true,
        defaultValue: "0",
      },
    ],
  },
  {
    category: "Interaction",
    name: "cracked#mouse_movement",
    desc: "Passes mouse move events to a callback. Tracks the movement of the mouse.\nweb audio",
  },
  {
    category: "Interaction",
    name: "cracked#key_press",
    desc: "Passes key press events to a callback. Tracks keyboard activity.\nweb audio",
  },
  {
    category: "Miscellaneous",
    name: "cracked#clip",
    desc: "Clips audio level at 1/-1",
  },
  {
    category: "Miscellaneous",
    name: "cracked#dac",
    desc: "System out - destination with a master volume. Output is clipped if gain is 1 or less.",
    params: [
      {
        name: "params",
        type: "Number",
        description: "system out gain",
        optional: true,
        defaultValue: "1",
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#adc",
    desc: "System in - input with a master volume",
    params: [
      {
        name: "params",
        type: "Number",
        description: "system in gain",
        optional: true,
        defaultValue: "1",
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#out",
    desc: "System out - destination with a master volume\nAlias for dac",
    params: [
      {
        name: "params",
        type: "Number",
        description: "system out gain",
        optional: true,
        defaultValue: "1",
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#multi_out",
    desc: "System multi_out - destination with a master volume w/ multi-channel support",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#in",
    desc: "System in - input with a master volume\nAlias for adc",
    params: [
      {
        name: "params",
        type: "Number",
        description: "system in gain",
        optional: true,
        defaultValue: "1",
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#panner",
    desc: "Panner - simple stereo panner",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Miscellaneous",
    name: "cracked#sampler",
    desc: "Sampler - sound file player\n\n[See more sampler examples](examples/sampler.html)",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "userParams.path",
        type: "String",
        description: "path to sound file to play",
        optional: true,
        defaultValue: "''",
      },
    ],
  },
  {
    category: "Modulator",
    name: "cracked#lfo",
    desc: "Low Frequency Oscillator\n\n[See more LFO examples](examples/modulation.html)",
    params: [
      {
        name: "userParams",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Modulator",
    name: "cracked#stepper",
    desc: "Stepper\n\nfill an audio buffer with a series of discrete values.",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
      {
        name: "[params.fn=function",
        type: "Function",
        description:
          "to generate values (if not supplied, then random values between -1 & 1)]",
        optional: false,
      },
      {
        name: "[params.steps=number",
        type: "Number",
        description: "of steps in the buffer]",
        optional: false,
      },
      {
        name: "[params.length=length",
        type: "Number",
        description: "of the buffer in seconds]",
        optional: false,
      },
    ],
  },
  {
    category: "Noise",
    name: "cracked#noise",
    desc: "noise parametrized noise node\n\n[See more noise examples](examples/noise.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Noise",
    name: "cracked#pink",
    desc: "Pink Noise\n\n[See more noise examples](examples/noise.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Noise",
    name: "cracked#white",
    desc: "White Noise\n\n[See more noise examples](examples/noise.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Noise",
    name: "cracked#brown",
    desc: "Brown Noise\n\n[See more noise examples](examples/noise.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Oscillator",
    name: "cracked#sine",
    desc: "Sine Wave Oscillator\n\n[See more oscillator examples](examples/oscillators.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Oscillator",
    name: "cracked#square",
    desc: "Square Wave Oscillator\n\n[See more oscillator examples](examples/oscillators.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Oscillator",
    name: "cracked#saw",
    desc: "Sawtooth Wave Oscillator\n\n[See more oscillator examples](examples/oscillators.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Oscillator",
    name: "cracked#triangle",
    desc: "Triangle Wave Oscillator\n\n[See more oscillator examples](examples/oscillators.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#frequency",
    desc: "[See more control examples](examples/control.html)\n\nFrequency setter convenience method",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "frequency to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#detune",
    desc: "Detune setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "detune frequency to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#type",
    desc: "Type setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "String",
        description: "oscillator type to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#volume",
    desc: "Gain setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "gain to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#fadeOut",
    desc: "Fade out convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "optional time to set in seconds. Defaults to 0.02",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#fadeIn",
    desc: "Fade in convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "optional time to set in seconds. Defaults to 0.02",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#time",
    desc: "Delay time setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "delay time to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#feedback",
    desc: "Feedback setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "feedback amount to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#speed",
    desc: "Speed setter convenience method\n\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "sampler speed to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#drive",
    desc: "Drive setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "drive distortion/waveshaper/etc to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#distortion",
    desc: "Distortion setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "distortion to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#q",
    desc: "q setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "q value to set",
        optional: false,
      },
    ],
  },
  {
    category: "Setters",
    name: "cracked#pan",
    desc: "pan setter convenience method\n\n[See more control examples](examples/control.html)",
    params: [
      {
        name: "userParam",
        type: "Number",
        description: "pan value (1 to -1) to set",
        optional: false,
      },
    ],
  },
  {
    category: "Synth",
    name: "cracked#gang_of_oscillators",
    desc: "gang_of_oscillators\n\nJust a bunch of oscillators\n\n[See more synth examples](examples/synth.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Synth",
    name: "cracked#monosynth",
    desc: "monosynth\n\nSimple monophonic synth\n\n[See more synth examples](examples/synth.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Synth",
    name: "cracked#polysynth",
    desc: "polysynth\n\nSimple polyphonic synth\n\n[See more synth examples](examples/synth.html)",
    params: [
      {
        name: "params",
        type: "Object",
        description: "map of optional values",
        optional: true,
      },
    ],
  },
  {
    category: "Utility",
    name: "cracked#play",
    desc: "Convenient way to say start everything\n\n[See more control examples](examples/control.html)",
  },
  {
    category: "Utility",
    name: "cracked#scale",
    desc: "Scale an input number between min & max to an output number between a min & max. Supports logarithmic or linear scaling.",
  },
  {
    category: "Utility",
    name: "cracked#sec2ms",
    desc: "Converts a second value to millisecond value",
  },
  {
    category: "Utility",
    name: "cracked#ms2sec",
    desc: "Converts a millisecond value to second value",
  },
  {
    category: "Utility",
    name: "cracked#ms2min",
    desc: "Converts a millisecond value to minute value",
  },
  {
    category: "Utility",
    name: "cracked#min2ms",
    desc: "Converts a minute value to a millisecond value",
  },
  {
    category: "Utility",
    name: "cracked#isSupported",
    desc: "Returns a boolean true if the browser supports\nweb audio",
  },
  {
    category: "Utility",
    name: "cracked#pitch2freq",
    desc: "Converts a pitch value to frequency",
  },
  {
    category: "Utility",
    name: "cracked#freq2pitch",
    desc: "Converts a frequency to a pitch value",
  },
];

// This script turns the params into codemirror autocomplete Completion options
const paramOptions = {};
docs
  .filter((d) => d.params)
  .forEach((d) => {
    var nodeForParam = d.name?.split("#")[1];
    if (!paramOptions[nodeForParam]) {
      paramOptions[nodeForParam] = [];
    }

    d.params.forEach((p) => {
      if (p.type == "Object") {
        return; // skip "userParam object args"
      }

      // handle cases like userParm.path
      let label = p.name.split('.').pop()
      paramOptions[nodeForParam].push({
        label: label,
        type: p.type,
        detail: p.description,
      });
    });
  });

console.log(paramOptions);
