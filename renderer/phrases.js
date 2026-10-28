// Everything the pet can say. `{name}` placeholders are filled from the vars passed to phrase().

const LINES = {
  morning: ['Good morning! ☀️', 'Morning!', 'Rise and shine!'],
  afternoon: ['Good afternoon!', 'Hi there!'],
  evening: ['Good evening!', 'Evening~'],
  night: ["It's late… don't stay up too long", 'Night owl, huh? 🦉'],
  typingFast: ["You're on fire! 🔥", 'So fast!', 'Clack clack clack!', 'Go go go!'],
  wake: ['*yawn*', "I'm up, I'm up!", 'Five more minutes…'],
  fling: ['Wheee!', 'Whoaaa!', 'Again! Again!'],
  hardLanding: ['Ow!', '@_@', 'Oof…'],
  caught: ['Gotcha!', 'Got it!', 'Hehe, caught you!'],
  trick: ['Ta-da! ✨', 'Did you see that?', 'Nailed it!'],
  yum: ['Yum!', 'Nom nom nom', 'Delicious!'],
  full: ["I'm full!", 'No more, thanks!'],
  cuddle: ['Purr~', '♥', 'Hehe~'],
  playStart: ['Ball!!', 'Ooh, a ball!'],
  playDone: ['That was fun!', 'Best game ever!', 'Again later?'],
  hungry: ["I'm hungry…", 'Snack time? (right-click me)', '*tummy rumbles*'],
  sad: ['Play with me?', "I'm bored…", '*sigh*'],
  happy: ['♪', 'Life is good~', 'Hehe~'],
  idle: ['Hmm~', '…', '♪', 'What are you working on?'],
  break: ['Time for a quick break! Stretch a bit 🙆', "You've been at it a while. Rest your eyes 👀"],
  water: ['Drink some water! 💧', 'Hydration check! 💧'],
  'pomodoro-focus': ['Focus time! 🍅 {min} min'],
  'pomodoro-short': ['Break time! ☕ {min} min'],
  'pomodoro-long': ['Long break! 🎉 {min} min'],
  'pomodoro-stop': ['Pomodoro stopped.'],
  halloween: ['Happy Halloween! 🎃', 'Boo! 👻', 'Trick or treat!'],
  christmas: ['Merry Christmas! 🎄', 'Ho ho ho!'],
  newyear: ['Happy New Year! 🎉'],
  winter: ["Brr, it's cold! ❄️", 'Snow day!'],
  valentine: ["Happy Valentine's Day! 💕"],
  levelUp: ['Level {level}! 🎉', 'I leveled up! (level {level})'],
  newFriend: ["Hi everyone! I'm {name}!", 'Hello! {name} here!'],
  goodbye: ['Bye bye! 👋', 'See you around!'],
  summon: ['You called?', 'Here!', 'Poof! ✨'],
  backHome: ['Here I am!', 'You found me!', "I'm back!"],
  tag: ["Tag! You're it!", 'Gotcha!'],
  chaseFriend: ['Come back here!', 'Tag!'],
  fleeing: ['Catch me!', 'Eek!'],
  climb: ['Up I go!', 'Wall time!'],
  jump: ['Hup!', 'Boing!'],
  whoa: ['Whoa!', 'Hey, my window!', 'Aaah!'],
  mount: ['Made it!', 'Nice view up here!', 'Top of the world!'],
  petted: ['Purr~', "Mmm, that's nice", '♥'],
  tickled: ['Hehe! Stop it!', 'That tickles!', 'Hahaha!'],
  laser: ['A red dot!!', "I'll get it!", 'Must. Catch. Dot.'],
  yarn: ['Yarn!!', 'Ooh, string!'],
  treatSpotted: ['Treat!!', 'Mine!', 'Snack!'],
  ateTreat: ['Yummy!', 'Crunchy!', 'Best. Treat. Ever.'],
  newFurniture: ['Ooh, a new {item}!', 'Is that {item} for us?'],
  scratch: ['Scritch scratch', 'Ahh, much better'],
  sniff: ['*sniff sniff*', 'Nice plant!'],
  welcomeBack: ['Welcome back!', "You're back!"],
  missedYou: ['I missed you!', "Yay, you're back! ♥"],
  nightfall: ["It's getting late… 🌙", 'Sleepy time soon? 🌙'],
  lowBattery: ["Battery's low… I'm sleepy 🔋", 'Plug me in? 🔋'],
  charging: ['Ahh, charging! ⚡', 'Power! ⚡'],
  reminder: ['Psst! A reminder for you', "Don't forget!"],
};

export function phrase(key, vars = {}) {
  const options = LINES[key] ?? [key];
  const line = options[Math.floor(Math.random() * options.length)];
  return line.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

export function greetingKey(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
