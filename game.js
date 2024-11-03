// Game variables
let scene, camera, renderer;
let player, ai;
let gameSpeed = 1;
let aiDifficulty = 'normal';
let gameRunning = false;
let gameOver = false;
let round = 1;
const totalRounds = 5;
let playerScore = 0;
let aiScore = 0;

const arenaSize = 100; // Half the size of the arena

// Touch controls
let touchStartX = null;

const gameContainer = document.getElementById('gameContainer');

// Add this near the top with other game variables
const aiConfig = {
    easy: {
        turnSpeed: 0.02,
        wallAvoidanceDistance: 20,
        wallAvoidanceWeight: 0.9,
        playerChaseWeight: 0.1
    },
    normal: {
        turnSpeed: 0.1,
        wallAvoidanceDistance: 25,
        wallAvoidanceWeight: 0.8,
        playerChaseWeight: 0.2
    },
    hard: {
        turnSpeed: 0.2,
        wallAvoidanceDistance: 30,
        wallAvoidanceWeight: 0.7,
        playerChaseWeight: 0.3
    }
};


function setAIDifficulty(difficulty) {
    aiDifficulty = difficulty;
    console.log(`AI Difficulty set to: ${difficulty}`);
}

// Initialize the Three.js scene
function initScene() {
    // Remove previous renderer if it exists
    if (renderer) {
        renderer.dispose();
        gameContainer.removeChild(renderer.domElement);
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Camera setup for third-person view
    camera = new THREE.PerspectiveCamera(
        75, window.innerWidth / window.innerHeight, 0.1, 1000
    );

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    gameContainer.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(0, 50, 0);
    scene.add(directionalLight);

    // Floor (Arena)
    const floorGeometry = new THREE.PlaneGeometry(arenaSize * 2, arenaSize * 2, 20, 20);
    const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Walls
    const wallHeight = 5; // Adjusted to match bike and trail height
    const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, wireframe: true });

    const wallGeometry = new THREE.PlaneGeometry(arenaSize * 2, wallHeight);

    // Front Wall
    const frontWall = new THREE.Mesh(wallGeometry, wallMaterial);
    frontWall.position.set(0, wallHeight / 2, -arenaSize);
    scene.add(frontWall);

    // Back Wall
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, wallHeight / 2, arenaSize);
    backWall.rotation.y = Math.PI;
    scene.add(backWall);

    // Left Wall
    const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
    leftWall.position.set(-arenaSize, wallHeight / 2, 0);
    leftWall.rotation.y = Math.PI / 2;
    scene.add(leftWall);

    // Right Wall
    const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
    rightWall.position.set(arenaSize, wallHeight / 2, 0);
    rightWall.rotation.y = -Math.PI / 2;
    scene.add(rightWall);

    // Resize handling
    window.addEventListener('resize', onWindowResize);
}

// Window resize handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Bike class
class Bike {
    constructor(color, trailColor, isAI = false) {
        this.isAI = isAI;
        this.speed = 0.5 * gameSpeed;
        this.direction = new THREE.Vector3(1, 0, 0); // Start moving along X axis
        this.alive = true;

        // Bike model
        const geometry = new THREE.BoxGeometry(1, 1, 2);
        const material = new THREE.MeshStandardMaterial({ color });
        this.mesh = new THREE.Mesh(geometry, material);
        scene.add(this.mesh);

        // Initial position
        if (isAI) {
            this.mesh.position.set(-10, 0.5, -10);
            this.direction = new THREE.Vector3(1, 0, 0);
            this.mesh.rotation.y = Math.PI; // Face the correct direction
        } else {
            this.mesh.position.set(10, 0.5, 10);
            this.direction = new THREE.Vector3(-1, 0, 0);
            this.mesh.rotation.y = 0; // Face the correct direction
        }

        // Trail
        this.trailColor = trailColor;
        this.trailHeight = 1; // Match bike height
        this.trailThickness = 0.5;
        this.maxTrailSegments = 100; // Limit the number of trail segments
        this.trailSegmentIndex = 0;

        // Create the geometry and material for instanced trail segments
        const trailSegmentGeometry = new THREE.BoxGeometry(
            this.trailThickness,
            this.trailHeight,
            1 // Length will be adjusted per instance
        );

        this.trailMaterial = new THREE.MeshStandardMaterial({
            color: this.trailColor,
            emissive: this.trailColor,
            emissiveIntensity: 0.7,
            metalness: 0.5,
            roughness: 0.5,
        });

        // Create the instanced mesh
        this.trailInstancedMesh = new THREE.InstancedMesh(
            trailSegmentGeometry,
            this.trailMaterial,
            this.maxTrailSegments
        );
        scene.add(this.trailInstancedMesh);

        this.lastPosition = this.mesh.position.clone();

        // Collision boxes for trail segments
        this.trailBoundingBoxes = new Array(this.maxTrailSegments).fill(null);

        // Smooth turning variables
        this.isTurning = false;
        this.turnDirection = null;
        this.turnProgress = 0;
        this.turnDuration = 10; // Number of frames over which the turn occurs
        this.targetRotation = 0;
        this.startRotation = 0;
        this.startDirection = this.direction.clone();
        this.targetDirection = this.direction.clone();
    }

    update() {
        if (!this.alive) return;

        // Handle smooth turning
        if (this.isTurning) {
            this.turnProgress++;

            // Calculate interpolation factor
            const t = this.turnProgress / this.turnDuration;

            // Smooth interpolation using ease-in-out
            const smoothStep = t * t * (3 - 2 * t);

            // Interpolate rotation
            const currentRotation = THREE.MathUtils.lerp(
                this.startRotation,
                this.targetRotation,
                smoothStep
            );
            this.mesh.rotation.y = currentRotation;

            // Interpolate direction
            this.direction = this.startDirection.clone().lerp(
                this.targetDirection,
                smoothStep
            ).normalize();

            if (this.turnProgress >= this.turnDuration) {
                // Finish turning
                this.isTurning = false;
                this.direction = this.targetDirection.clone();
                this.mesh.rotation.y = this.targetRotation;
            }
        }

        // Move bike
        const moveVector = this.direction.clone().multiplyScalar(this.speed);
        this.mesh.position.add(moveVector);

        // Update camera position for player
        if (!this.isAI) {
            // Third-person camera position
            const cameraOffset = this.direction.clone().multiplyScalar(-10);
            cameraOffset.y = 5; // Height above the bike
            camera.position.lerp(
                this.mesh.position.clone().add(cameraOffset),
                0.1
            );
            camera.lookAt(this.mesh.position);
        }

        // Add new trail segment if bike has moved significantly
        if (this.lastPosition.distanceTo(this.mesh.position) >= 1) {
            this.addTrailSegment(this.lastPosition.clone(), this.mesh.position.clone());
            this.lastPosition.copy(this.mesh.position);
        }
    }

    turn(direction) {
        if (!this.alive || this.isTurning) return;

        this.isTurning = true;
        this.turnDirection = direction;
        this.turnProgress = 0;
        this.turnDuration = 10; // Adjust for desired smoothness

        // Store starting rotation and direction
        this.startRotation = this.mesh.rotation.y;
        this.startDirection = this.direction.clone();

        // Calculate target rotation and direction
        const angle = (direction === 'left') ? Math.PI / 2 : -Math.PI / 2;
        this.targetRotation = this.startRotation + angle;

        // Wrap target rotation between -PI and PI
        this.targetRotation = THREE.MathUtils.euclideanModulo(this.targetRotation + Math.PI, Math.PI * 2) - Math.PI;

        // Calculate target direction vector
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        this.targetDirection = this.startDirection.clone().applyQuaternion(quaternion).normalize();

        // Update lastPosition to current position
        this.lastPosition.copy(this.mesh.position);
    }

    addTrailSegment(startPos, endPos) {
        const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5);
        const length = startPos.distanceTo(endPos);

        // Ignore zero-length segments
        if (length === 0) {
            return;
        }

        // Create transformation matrix for the instance
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3(midPoint.x, this.trailHeight / 2, midPoint.z);
        const scale = new THREE.Vector3(1, 1, length);
        const rotationY = Math.atan2(endPos.x - startPos.x, endPos.z - startPos.z);

        matrix.compose(
            position,
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
            scale
        );

        // Set the instance matrix
        this.trailInstancedMesh.setMatrixAt(this.trailSegmentIndex, matrix);
        this.trailInstancedMesh.instanceMatrix.needsUpdate = true;

        // Update collision boxes
        const boundingBox = new THREE.Box3().setFromCenterAndSize(
            position,
            new THREE.Vector3(this.trailThickness, this.trailHeight, length)
        );
        this.trailBoundingBoxes[this.trailSegmentIndex] = boundingBox;

        // Increment and wrap the trail segment index
        this.trailSegmentIndex = (this.trailSegmentIndex + 1) % this.maxTrailSegments;
    }
}

// Initialize game elements
function initGame() {
    // Clear previous game objects
    if (player) {
        scene.remove(player.mesh);
        scene.remove(player.trailInstancedMesh);
    }
    if (ai) {
        scene.remove(ai.mesh);
        scene.remove(ai.trailInstancedMesh);
    }

    // Reset variables
    gameOver = false;

    // Create player and AI bikes
    player = new Bike(0x009999, 0x00ffff, false); // Slightly darker bike color
    ai = new Bike(0x990099, 0xff00ff, true);

    // Start game loop
    if (!gameRunning) {
        gameRunning = true;
        animate();
    }
}

// Game loop
function animate() {
    if (!gameOver) {
        requestAnimationFrame(animate);

        // Update bikes
        player.update();
        aiUpdate();

        // Collision detection
        checkCollisions();

        renderer.render(scene, camera);
    } else {
        // Handle round end
        handleRoundEnd();
    }
}

// AI movement logic
function aiUpdate() {
    ai.update();

    // AI difficulty settings
    let changeDirectionProbability;
    switch (aiDifficulty) {
        case 'easy':
            changeDirectionProbability = 0.05;
            break;
        case 'normal':
            changeDirectionProbability = 0.02;
            break;
        case 'hard':
            changeDirectionProbability = 0.01;
            break;
    }

    // Randomly decide whether to change direction
    if (!ai.isTurning && Math.random() < changeDirectionProbability) {
        const turn = Math.random() < 0.5 ? 'left' : 'right';
        ai.turn(turn);
    }
}

function updateAI() {
    if (!ai.alive) return;
    
    const config = aiConfig[aiDifficulty] || aiConfig.normal;
    const wallAvoidanceVector = getWallAvoidanceVector();
    const playerChaseVector = getPlayerChaseVector();
    
    // Dynamically adjust weights based on wall proximity
    let wallWeight = config.wallAvoidanceWeight;
    let playerWeight = config.playerChaseWeight;
    
    // If very close to walls, prioritize avoidance
    if (wallAvoidanceVector.length() > 0.8) {
        wallWeight = 0.9;
        playerWeight = 0.1;
    }

    const targetDirection = new THREE.Vector3()
        .addVectors(
            wallAvoidanceVector.multiplyScalar(wallWeight),
            playerChaseVector.multiplyScalar(playerWeight)
        )
        .normalize();

    // Calculate angle to target direction
    const currentDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(ai.mesh.quaternion);
    const targetAngle = Math.atan2(targetDirection.x, targetDirection.z);
    const currentAngle = Math.atan2(currentDirection.x, currentDirection.z);

    let angleChange = targetAngle - currentAngle;
    angleChange = Math.atan2(Math.sin(angleChange), Math.cos(angleChange));

    // Apply turn based on difficulty
    const turnQuaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        angleChange * config.turnSpeed
    );
    ai.mesh.quaternion.multiplyQuaternions(turnQuaternion, ai.mesh.quaternion);

    // Move AI forward
    const moveVector = currentDirection.multiplyScalar(ai.speed);
    ai.mesh.position.add(moveVector);
}

function getWallAvoidanceVector() {
    const config = aiConfig[aiDifficulty] || aiConfig.normal;
    const avoidanceVector = new THREE.Vector3();
    
    // Check distances to walls
    const distanceToRight = arenaSize - ai.mesh.position.x;
    const distanceToLeft = arenaSize + ai.mesh.position.x;
    const distanceToFront = arenaSize - ai.mesh.position.z;
    const distanceToBack = arenaSize + ai.mesh.position.z;
    
    // Add repulsion forces from nearby walls
    if (distanceToRight < config.wallAvoidanceDistance) {
        avoidanceVector.x -= 1.0 * (config.wallAvoidanceDistance - distanceToRight);
    }
    if (distanceToLeft < config.wallAvoidanceDistance) {
        avoidanceVector.x += 1.0 * (config.wallAvoidanceDistance - distanceToLeft);
    }
    if (distanceToFront < config.wallAvoidanceDistance) {
        avoidanceVector.z -= 1.0 * (config.wallAvoidanceDistance - distanceToFront);
    }
    if (distanceToBack < config.wallAvoidanceDistance) {
        avoidanceVector.z += 1.0 * (config.wallAvoidanceDistance - distanceToBack);
    }
    
    if (avoidanceVector.length() > 0) {
        avoidanceVector.normalize();
    }
    
    return avoidanceVector.normalize();
}

function getPlayerChaseVector() {
    const toPlayer = new THREE.Vector3()
        .subVectors(player.position, ai.position)
        .normalize();
    
    return toPlayer;
}

// Collision detection
function checkCollisions() {
    // Check player collisions
    if (checkWallCollision(player.mesh.position) || checkTrailCollision(player, ai)) {
        player.alive = false;
    }

    // Check AI collisions
    if (checkWallCollision(ai.mesh.position) || checkTrailCollision(ai, player)) {
        ai.alive = false;
    }

    // Check for game over
    if (!player.alive || !ai.alive) {
        gameOver = true;
    }
}

const aiRadius = 1; // Assuming a radius of 1 unit
function checkWallCollision(position) {
    return (
        position.x > arenaSize - aiRadius ||
        position.x < -arenaSize + aiRadius ||
        position.z > arenaSize - aiRadius ||
        position.z < -arenaSize + aiRadius
    );
}

// Check collision with trails
function checkTrailCollision(bike, opponent) {
    const bikeBox = new THREE.Box3().setFromObject(bike.mesh);

    // Check collision with opponent's trail
    for (let i = 0; i < opponent.trailBoundingBoxes.length; i++) {
        const bbox = opponent.trailBoundingBoxes[i];
        if (bbox && bikeBox.intersectsBox(bbox)) {
            return true;
        }
    }

    // Determine indices of own trail segments to skip
    const segmentsToSkip = 5;
    const indicesToSkip = new Set();
    for (let n = 0; n < segmentsToSkip; n++) {
        const indexToSkip =
            (bike.trailSegmentIndex - 1 - n + bike.maxTrailSegments) % bike.maxTrailSegments;
        indicesToSkip.add(indexToSkip);
    }

    // Check collision with own trail
    for (let i = 0; i < bike.trailBoundingBoxes.length; i++) {
        if (indicesToSkip.has(i)) {
            continue;
        }
        const bbox = bike.trailBoundingBoxes[i];
        if (bbox && bikeBox.intersectsBox(bbox)) {
            return true;
        }
    }

    return false;
}

// Handle player input
function onKeyDown(e) {
    if (!player.alive) return;

    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') {
        player.turn('left');
    } else if (key === 'arrowright' || key === 'd') {
        player.turn('right');
    }
}

document.addEventListener('keydown', onKeyDown);

// Touch controls
function onTouchStart(e) {
    touchStartX = e.touches[0].clientX;
}

function onTouchEnd(e) {
    const touchEndX = e.changedTouches[0].clientX;
    if (touchStartX !== null) {
        if (touchEndX - touchStartX > 50) {
            player.turn('right');
        } else if (touchStartX - touchEndX > 50) {
            player.turn('left');
        }
    }
    touchStartX = null;
}

gameContainer.addEventListener('touchstart', onTouchStart);
gameContainer.addEventListener('touchend', onTouchEnd);

// Handle round end
function handleRoundEnd() {
    gameRunning = false;

    // Update scores
    if (player.alive && !ai.alive) {
        playerScore++;
        displayMessage('You Win!', 0x00ff00);
        triggerFireworks();
    } else if (!player.alive && ai.alive) {
        aiScore++;
        displayMessage('AI Wins!', 0xff0000);
        displayAITaunt();
    } else {
        displayMessage('Draw!', 0xffff00);
    }

    // Update scoreboard
    updateScoreboard();

    round++;
    if (round <= totalRounds) {
        setTimeout(() => {
            initGame();
        }, 3000);
    } else {
        // Display final result
        setTimeout(() => {
            if (playerScore > aiScore) {
                displayMessage('Congratulations, You Won the Game!', 0x00ff00);
                triggerFireworks();
            } else if (playerScore < aiScore) {
                displayMessage('Game Over, AI Dominated!', 0xff0000);
                displayAITaunt();
            } else {
                displayMessage('The Game Ended in a Draw!', 0xffff00);
            }
        }, 3000);
    }
}

// Update scoreboard
function updateScoreboard() {
    let scoreboard = document.getElementById('scoreboard');
    if (!scoreboard) {
        scoreboard = document.createElement('div');
        scoreboard.id = 'scoreboard';
        scoreboard.style.position = 'absolute';
        scoreboard.style.top = '10px';
        scoreboard.style.left = '10px';
        scoreboard.style.color = '#ffffff';
        scoreboard.style.fontFamily = 'Courier New';
        scoreboard.style.fontSize = '20px';
        document.body.appendChild(scoreboard);
    }
    scoreboard.innerHTML = `Round: ${round}/${totalRounds}<br>Player Score: ${playerScore}<br>AI Score: ${aiScore}`;
}

// Display messages in 3D space
function displayMessage(text, color) {
    const loader = new THREE.FontLoader();
    loader.load(
        'https://threejs.org/examples/fonts/helvetiker_bold.typeface.json',
        function (font) {
            const geometry = new THREE.TextGeometry(text, {
                font: font,
                size: 2,
                height: 0.5,
            });
            const material = new THREE.MeshBasicMaterial({ color });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(-10, 10, -10);
            scene.add(mesh);

            // Remove the message after a while
            setTimeout(() => {
                scene.remove(mesh);
            }, 3000);
        }
    );
}

// Display AI taunt
function displayAITaunt() {
    const taunts = [
        "Better luck next time!",
        "Is that all you've got?",
        "You can't beat me!",
        "Try harder!",
        "I'm unbeatable!",
    ];
    const taunt = taunts[Math.floor(Math.random() * taunts.length)];
    displayMessage(taunt, 0xffffff);
}

// Fireworks effect
function triggerFireworks() {
    // Simple particle system for fireworks
    const particleCount = 500;
    const particles = new THREE.BufferGeometry();
    const positions = [];

    for (let i = 0; i < particleCount; i++) {
        positions.push(
            (Math.random() - 0.5) * 20,
            Math.random() * 10 + 5,
            (Math.random() - 0.5) * 20
        );
    }

    particles.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffff00,
        size: 0.5,
        transparent: true,
        opacity: 1,
    });

    const particleSystem = new THREE.Points(particles, material);
    scene.add(particleSystem);

    // Animate particles
    const animateFireworks = () => {
        material.opacity -= 0.01;
        if (material.opacity <= 0) {
            scene.remove(particleSystem);
        } else {
            requestAnimationFrame(animateFireworks);
        }
    };
    animateFireworks();
}

// Settings and menu handling
const mainMenu = document.getElementById('mainMenu');
const settingsMenu = document.getElementById('settingsMenu');
const startGameBtn = document.getElementById('startGameBtn');
const settingsBtn = document.getElementById('settingsBtn');
const backBtn = document.getElementById('backBtn');
const gameSpeedInput = document.getElementById('gameSpeed');
const gameSpeedValue = document.getElementById('gameSpeedValue');
const difficultySelect = document.getElementById('difficulty');

startGameBtn.addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    initScene();
    initGame();
    updateScoreboard();
});

settingsBtn.addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    settingsMenu.classList.remove('hidden');
});

backBtn.addEventListener('click', () => {
    settingsMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
});

gameSpeedInput.addEventListener('input', () => {
    gameSpeed = parseFloat(gameSpeedInput.value);
    gameSpeedValue.textContent = gameSpeed.toFixed(1);
});

difficultySelect.addEventListener('change', () => {
    aiDifficulty = difficultySelect.value;
});

// Ensure the game stops when the tab is inactive
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        gameOver = true;
    }
});
