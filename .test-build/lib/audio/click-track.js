"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClickTrack = createClickTrack;
/** Audio-clock clicks shared by transport metronome and a cancellable four-beat count-in. */
function createClickTrack(backend) {
    let metronomeVoice = null;
    let cancelCountIn = null;
    function silenceMetronome() {
        metronomeVoice === null || metronomeVoice === void 0 ? void 0 : metronomeVoice.dispose();
        metronomeVoice = null;
    }
    return {
        click(time, accent) {
            metronomeVoice !== null && metronomeVoice !== void 0 ? metronomeVoice : (metronomeVoice = backend.createVoice("metronome"));
            metronomeVoice.attack(accent ? 84 : 76, time, accent ? 0.65 : 0.4);
        },
        silenceMetronome,
        countIn(bpm, onBeat) {
            cancelCountIn === null || cancelCountIn === void 0 ? void 0 : cancelCountIn();
            const voice = backend.createVoice("metronome");
            const startSec = backend.now();
            const beatSec = 60 / bpm;
            const timers = [];
            let finished = false;
            return new Promise((resolve, reject) => {
                const finish = (completed) => {
                    if (finished)
                        return;
                    finished = true;
                    timers.forEach((id) => backend.clearTimeout(id));
                    voice.dispose();
                    cancelCountIn = null;
                    resolve(completed);
                };
                cancelCountIn = () => finish(false);
                // Schedule sound in advance on the audio clock; UI countdown timers do not drive sound.
                try {
                    for (let beat = 0; beat < 4; beat++) {
                        voice.attack(beat === 0 ? 84 : 76, startSec + beat * beatSec, beat === 0 ? 0.65 : 0.4);
                        timers.push(backend.setTimeout(() => { if (!finished)
                            onBeat(4 - beat); }, beat * beatSec));
                    }
                    timers.push(backend.setTimeout(() => finish(true), 4 * beatSec));
                }
                catch (error) {
                    finished = true;
                    timers.forEach((id) => backend.clearTimeout(id));
                    voice.dispose();
                    cancelCountIn = null;
                    reject(error);
                }
            });
        },
        cancelCountIn() { cancelCountIn === null || cancelCountIn === void 0 ? void 0 : cancelCountIn(); },
        dispose() {
            cancelCountIn === null || cancelCountIn === void 0 ? void 0 : cancelCountIn();
            silenceMetronome();
        },
    };
}
