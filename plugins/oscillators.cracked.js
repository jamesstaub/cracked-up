//need a custom wave osc

/**
 * Sine Wave Oscillator
 *
 * [See more oscillator examples](examples/oscillators.html)
 *
 * @plugin
 * @category Oscillator
 * @function
 * @memberof cracked
 * @name cracked#sine
 * @public
 * @param {Object} [params] map of optional values
 * @param {Number} [params.frequency=440] frequency in hz of the oscillator 
 * @param {Number} [params.detune=0] detune amount in cents
 * @param {String} [params.type=sine] oscillator type
 */
cracked.sine = function (params) {

    var freq = __.isNum(params) ? params : 440;
    var userParams = __.isObj(params) ? params : {};
    var options = {};
    options.type = userParams.type || "sine";
    options.frequency = userParams.frequency || freq;
    options.detune = userParams.detune || 0;
    options.mapping = userParams.mapping || {};

    __.begin("sine", userParams).osc(options).end("sine");

    return cracked;
};
/**
 * Square Wave Oscillator
 *
 * [See more oscillator examples](examples/oscillators.html)
 *
 * @plugin
 * @category Oscillator
 * @function
 * @memberof cracked
 * @name cracked#square
 * @public
 * @param {Object} [params] map of optional values
 * @param {Number} [params.frequency=440] frequency in hz of the oscillator 
 * @param {Number} [params.detune=0] detune amount in cents
 * @param {String} [params.type=sine]  oscillator type
 */
cracked.square = function (params) {

    var freq = __.isNum(params) ? params : 440;
    var userParams = __.isObj(params) ? params : {};
    var options = {};
    options.type = userParams.type || "square";
    options.frequency = userParams.frequency || freq;
    options.detune = userParams.detune || 0;
    options.mapping = userParams.mapping || {};

    __.begin("square", userParams).osc(options).end("square");

    return cracked;
};
/**
 * Sawtooth Wave Oscillator
 *
 * [See more oscillator examples](examples/oscillators.html)
 *
 * @plugin
 * @category Oscillator
 * @function
 * @memberof cracked
 * @name cracked#saw
 * @public
 * @param {Object} [params] map of optional values
 * @param {Number} [params.frequency=440] frequency in hz of the oscillator 
 * @param {Number} [params.detune=0] detune amount in cents
 * @param {String} [params.type=sine]  oscillator type
 */
cracked.saw = function (params) {

    var freq = __.isNum(params) ? params : 440;
    var userParams = __.isObj(params) ? params : {};
    var options = {};
    options.type = userParams.type || "sawtooth";
    options.frequency = userParams.frequency || freq;
    options.detune = userParams.detune || 0;
    options.mapping = userParams.mapping || {};

    __.begin("saw", userParams).osc(options).end("saw");

    return cracked;
};
/**
 * Triangle Wave Oscillator
 *
 * [See more oscillator examples](examples/oscillators.html)
 *
 * @plugin
 * @category Oscillator
 * @function
 * @memberof cracked
 * @name cracked#triangle
 * @public
 * @param {Object} [params] map of optional values
 * @param {Number} [params.frequency=440] frequency in hz of the oscillator 
 * @param {Number} [params.detune=0] detune amount in cents
 * @param {String} [params.type=sine]  oscillator type
 */
cracked.triangle = function (params) {

    var freq = __.isNum(params) ? params : 440;
    var userParams = __.isObj(params) ? params : {};
    var options = {};
    options.type = userParams.type || "triangle";
    options.frequency = userParams.frequency || freq;
    options.detune = userParams.detune || 0;
    options.mapping = userParams.mapping || {};

    __.begin("triangle", userParams).osc(options).end("triangle");

    return cracked;
};