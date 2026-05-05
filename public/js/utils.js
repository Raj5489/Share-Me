export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function getAnimalName(userId) {
  const animals = [
    "🦁 Lion", "🐯 Tiger", "🐻 Bear", "🦊 Fox", "🐺 Wolf", "🦅 Eagle",
    "🐧 Penguin", "🦉 Owl", "🐨 Koala", "🐼 Panda", "🦘 Kangaroo",
    "🦒 Giraffe", "🐘 Elephant", "🦏 Rhino", "🦓 Zebra", "🐰 Rabbit",
    "🐱 Cat", "🐶 Dog", "🐳 Whale", "🦈 Shark"
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) & 0xffffffff;
  }
  return animals[Math.abs(hash) % animals.length];
}

export function createRipple(event, element) {
  const circle = document.createElement("span");
  const diameter = Math.max(element.clientWidth, element.clientHeight);
  const radius = diameter / 2;

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${event.clientX - element.offsetLeft - radius}px`;
  circle.style.top = `${event.clientY - element.offsetTop - radius}px`;
  circle.classList.add("ripple");

  const ripple = element.getElementsByClassName("ripple")[0];
  if (ripple) {
    ripple.remove();
  }

  element.appendChild(circle);
}
