import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const markerFile = process.argv[3];

function startWatchdog() {
	setTimeout(() => {
		if (markerFile) writeFileSync(markerFile, "SELF_EXPIRY\n");
		process.stderr.write("WATCHDOG:99\n");
		process.exit(99);
	}, 4000);
}

switch (mode) {
	case "normal":
		process.stdout.write("READY:normal\n");
		process.stdout.write("STDOUT:normal\n");
		process.stderr.write("STDERR:normal\n");
		process.exit(0);
		break;
	case "nonzero":
		process.stdout.write("READY:nonzero\n");
		process.stderr.write("STDERR:nonzero:7\n");
		process.exit(7);
		break;
	case "ordinary-timeout":
		process.stdout.write("READY:ordinary-timeout\n");
		startWatchdog();
		break;
	case "sigterm-exit-zero":
		process.stdout.write("READY:sigterm-exit-zero\n");
		process.on("SIGTERM", () => {
			process.stderr.write("TERM:sigterm-exit-zero\n");
			process.exit(0);
		});
		startWatchdog();
		break;
	case "term-resistant":
		process.on("SIGTERM", () => {
			if (markerFile) writeFileSync(markerFile, "TERM:observed\n");
		});
		startWatchdog();
		process.stdout.write("READY:term-resistant\n");
		break;
	default:
		process.stderr.write("WATCHDOG:invalid-mode:99\n");
		process.exit(99);
}
