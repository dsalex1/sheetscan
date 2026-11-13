// Plays the score Verovio has loaded, with a small built-in synth.
export class Player {
  notes = [] // {id, t, dur (ms), pitch (MIDI)}
  #timer = null
  #context = null
  #master = null

  /** Read notes and timing from the toolkit's current score. Returns the MIDI file (base64). */
  load(tk) {
    const midi = tk.renderToMIDI()
    this.notes = tk
      .renderToTimemap()
      .flatMap((entry) => (entry.on ?? []).map((id) => ({ id, t: entry.tstamp, ...tk.getMIDIValuesForElement(id) })))
      .map(({ id, t, pitch, duration }) => ({ id, t, pitch, dur: duration }))
    return midi
  }

  get playing() {
    return this.#timer !== null
  }

  #audio() {
    this.#context ??= new AudioContext()
    this.#context.resume()
    if (!this.#master) {
      this.#master = this.#context.createGain()
      this.#master.gain.value = 0.5
      this.#master.connect(this.#context.destination)
    }
    return this.#context
  }

  #voice(pitch, when, seconds) {
    const context = this.#context
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12)
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(0.3, when + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.06, when + Math.max(seconds, 0.05))
    gain.gain.linearRampToValueAtTime(0, when + Math.max(seconds, 0.05) + 0.06)
    osc.connect(gain).connect(this.#master)
    osc.start(when)
    osc.stop(when + seconds + 0.1)
  }

  /** Sound one pitch now, as feedback while editing. */
  ping(pitch) {
    this.#voice(pitch, this.#audio().currentTime, 0.3)
  }

  /** Play from `from` ms. onTick(ids sounding now) runs ~25x a second; onEnd when it stops. */
  play(from, onTick, onEnd) {
    this.stop()
    const context = this.#audio()
    const start = context.currentTime + 0.1 - from / 1000
    const when = (ms) => start + ms / 1000
    const end = Math.max(0, ...this.notes.map((n) => n.t + n.dur))
    let next = this.notes.findIndex((n) => n.t >= from)
    if (next < 0) next = this.notes.length
    this.#onEnd = onEnd
    this.#timer = setInterval(() => {
      for (; next < this.notes.length && when(this.notes[next].t) < context.currentTime + 0.25; next++)
        this.#voice(this.notes[next].pitch, when(this.notes[next].t), this.notes[next].dur / 1000)
      const now = (context.currentTime - start) * 1000
      onTick(this.notes.filter((n) => n.t <= now && now < n.t + n.dur).map((n) => n.id))
      if (now > end) this.stop()
    }, 40)
  }
  #onEnd = null

  stop() {
    if (!this.playing) return
    clearInterval(this.#timer)
    this.#timer = null
    this.#master?.disconnect() // silences whatever is scheduled
    this.#master = null
    this.#onEnd?.()
  }
}
