// src/templates.js — project starter templates
// Extracted from monolithic index.html

const TEMPLATES = {
    empty: {
        name: "Empty",
        files: {
            "main.lua": `-- Empty project
function _update(dt)
end

function _draw()
    gfx.cls("#000")
    gfx.text("Hello LuaDeck!", 40, 80, "#fff", "20px sans-serif")
end`
        }
    },
    demo: {
        name: "Color Blob (Demo)",
        files: {
            "main.lua": `local player = require("player")

function _update(dt)
    player.update(dt)
end

function _draw()
    gfx.cls("#121212")
    player.draw()
    gfx.text("Move: Stick / WASD", 24, 40, "#fff", "16px sans-serif")
    gfx.text("A/B/X/Y or Z/X/C/V: colors", 24, 64, "#fff", "16px sans-serif")
    gfx.text(string.format("dt=%.3f", dt), 24, 90, "#888", "14px monospace")
end`,
            "player.lua": `local p = { x = 200, y = 200, color = "#ff2a5f", size = 28 }

function p.update(dt)
    local speed = 220 * (dt or 0.016)
    -- analog preferred, fallback to digital
    local ax, ay = axis(0), axis(1)
    if ax ~= 0 or ay ~= 0 then
        p.x = p.x + ax * speed
        p.y = p.y + ay * speed
    else
        if btn(0) then p.y = p.y - speed end
        if btn(1) then p.y = p.y + speed end
        if btn(2) then p.x = p.x - speed end
        if btn(3) then p.x = p.x + speed end
    end
    if btnp(4) then p.color = "#00e676" sfx.beep(520, 0.08) end
    if btnp(5) then p.color = "#ff2a5f" sfx.beep(420, 0.08) end
    if btnp(6) then p.color = "#2979ff" sfx.beep(620, 0.08) end
    if btnp(7) then p.color = "#ffea00" sfx.beep(720, 0.08) end
end

function p.draw()
    gfx.circlefill(p.x, p.y, p.size, p.color)
    gfx.circle(p.x, p.y, p.size + 4, "#ffffff")
end

return p`
        }
    },
    topdown: {
        name: "Top-down Shooter",
        files: {
            "main.lua": `local player = { x = 160, y = 240, r = 14, cooldown = 0 }
local bullets = {}
local enemies = {}
local score = 0
local spawn = 0

function _update(dt)
    local speed = 200 * dt
    local ax, ay = axis(0), axis(1)
    player.x = player.x + ax * speed
    player.y = player.y + ay * speed
    if btn(2) then player.x = player.x - speed end
    if btn(3) then player.x = player.x + speed end
    if btn(0) then player.y = player.y - speed end
    if btn(1) then player.y = player.y + speed end

    player.cooldown = player.cooldown - dt
    if (btn(4) or mouse.btn) and player.cooldown <= 0 then
        local tx, ty = mouse.x, mouse.y
        local dx, dy = tx - player.x, ty - player.y
        local len = math.sqrt(dx*dx + dy*dy)
        if len < 1 then dx, dy, len = 0, -1, 1 end
        table.insert(bullets, { x = player.x, y = player.y, vx = dx/len*320, vy = dy/len*320 })
        player.cooldown = 0.18
        sfx.beep(880, 0.05, "square")
    end

    for i = #bullets, 1, -1 do
        local b = bullets[i]
        b.x = b.x + b.vx * dt
        b.y = b.y + b.vy * dt
        if b.x < -10 or b.x > 400 or b.y < -10 or b.y > 800 then table.remove(bullets, i) end
    end

    spawn = spawn - dt
    if spawn <= 0 then
        table.insert(enemies, { x = math.random(30, 300), y = -20, r = 12 })
        spawn = 0.7
    end
    for i = #enemies, 1, -1 do
        local e = enemies[i]
        e.y = e.y + 80 * dt
        if e.y > 700 then table.remove(enemies, i)
        else
            for j = #bullets, 1, -1 do
                local b = bullets[j]
                local dx, dy = b.x - e.x, b.y - e.y
                if dx*dx + dy*dy < (e.r+4)^2 then
                    table.remove(bullets, j)
                    table.remove(enemies, i)
                    score = score + 1
                    sfx.beep(200, 0.1, "sawtooth")
                    break
                end
            end
        end
    end
end

function _draw()
    gfx.cls("#0a0e14")
    gfx.circlefill(player.x, player.y, player.r, "#00e676")
    for _, b in ipairs(bullets) do gfx.circlefill(b.x, b.y, 3, "#ffea00") end
    for _, e in ipairs(enemies) do gfx.circlefill(e.x, e.y, e.r, "#ff2a5f") end
    gfx.text("Score: " .. score, 16, 36, "#fff", "18px sans-serif")
    gfx.text("Aim with touch/mouse, A or click to shoot", 16, 60, "#888", "13px sans-serif")
end`
        }
    },
    platformer: {
        name: "Simple Platformer",
        files: {
            "main.lua": `local p = { x = 60, y = 100, vx = 0, vy = 0, onground = false }
local grav = 900
local platforms = {
    {0, 280, 400, 40},
    {80, 220, 80, 12},
    {200, 170, 90, 12},
    {40, 120, 70, 12},
}

function _update(dt)
    local ax = axis(0)
    if btn(2) then ax = -1 end
    if btn(3) then ax = 1 end
    p.vx = ax * 160
    p.vy = p.vy + grav * dt
    if (btnp(4) or btnp(0)) and p.onground then
        p.vy = -340
        p.onground = false
        sfx.beep(300, 0.07)
    end
    p.x = p.x + p.vx * dt
    p.y = p.y + p.vy * dt
    p.onground = false
    for _, pl in ipairs(platforms) do
        local px, py, pw, ph = pl[1], pl[2], pl[3], pl[4]
        if p.x + 12 > px and p.x - 12 < px + pw and p.y + 12 > py and p.y - 12 < py + ph then
            if p.vy > 0 and p.y - p.vy * dt <= py then
                p.y = py - 12
                p.vy = 0
                p.onground = true
            end
        end
    end
    if p.y > 400 then p.x, p.y, p.vx, p.vy = 60, 100, 0, 0 end
end

function _draw()
    gfx.cls("#1a237e")
    for _, pl in ipairs(platforms) do
        gfx.rectfill(pl[1], pl[2], pl[3], pl[4], "#4caf50")
    end
    gfx.rectfill(p.x - 12, p.y - 12, 24, 24, "#ff2a5f")
    gfx.text("Arrows/Stick move, A/Up jump", 16, 30, "#fff", "15px sans-serif")
end`
        }
    },
    raycast: {
        name: "Raycast 3D Maze",
        files: {
            "main.lua": `-- Raycast 3D
-- Left stick / WASD = movement only
-- Right side of screen = look (yaw + pitch)

local map = {
    {1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
    {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
    {1,0,2,2,0,0,0,3,3,0,0,4,4,0,0,1},
    {1,0,2,0,0,0,0,0,3,0,0,0,4,0,0,1},
    {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
    {1,0,0,0,5,5,0,0,0,0,6,6,0,0,0,1},
    {1,0,0,0,5,0,0,0,0,0,0,6,0,0,0,1},
    {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
    {1,0,7,0,0,0,0,1,1,0,0,0,0,8,0,1},
    {1,0,7,0,0,0,0,1,0,0,0,0,0,8,0,1},
    {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
    {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
    {1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
}

local player = {
    x = 1.5,
    y = 1.5,
    angle = 0.4,
    pitch = 0,
    speed = 3.2
}

local PITCH_MAX = math.pi / 2 - 0.01

local colors = {
    [1] = "#c44c4c",
    [2] = "#4caf50",
    [3] = "#2196f3",
    [4] = "#ff9800",
    [5] = "#9c27b0",
    [6] = "#00bcd4",
    [7] = "#ffeb3b",
    [8] = "#e91e63"
}

local function blocked(nx, ny)
    local r = 0.22
    local cells = {
        {math.floor(nx - r), math.floor(ny - r)},
        {math.floor(nx + r), math.floor(ny - r)},
        {math.floor(nx - r), math.floor(ny + r)},
        {math.floor(nx + r), math.floor(ny + r)},
    }
    for _, c in ipairs(cells) do
        local mx, my = c[1], c[2]
        if my < 1 or my > #map or mx < 1 or mx > #map[1] then return true end
        if map[my][mx] ~= 0 then return true end
    end
    return false
end

function _update(dt)
    -- LEFT STICK / WASD = movement only (no camera)
    local ax, ay = axis(0), axis(1)
    local move, strafe = 0, 0
    if math.abs(ay) > 0.05 then move = move - ay end
    if math.abs(ax) > 0.05 then strafe = strafe + ax end
    if btn(0) then move = move + 1 end
    if btn(1) then move = move - 1 end
    if btn(2) then strafe = strafe - 1 end
    if btn(3) then strafe = strafe + 1 end
    if move > 1.4 then move = 1.4 elseif move < -1.4 then move = -1.4 end
    if strafe > 1.4 then strafe = 1.4 elseif strafe < -1.4 then strafe = -1.4 end

    local cosA = math.cos(player.angle)
    local sinA = math.sin(player.angle)
    local dx = (cosA * move - sinA * strafe) * player.speed * dt
    local dy = (sinA * move + cosA * strafe) * player.speed * dt
    if not blocked(player.x + dx, player.y) then player.x = player.x + dx end
    if not blocked(player.x, player.y + dy) then player.y = player.y + dy end

    -- RIGHT TOUCH = camera look (yaw + pitch)
    local lookX, lookY = look()
    player.angle = player.angle + lookX
    player.pitch = player.pitch - lookY
    if player.pitch >  PITCH_MAX then player.pitch =  PITCH_MAX end
    if player.pitch < -PITCH_MAX then player.pitch = -PITCH_MAX end
end

function _draw()
    gfx.cls("#000")
    gfx.raycast({
        map = map,
        x = player.x,
        y = player.y,
        angle = player.angle,
        pitch = player.pitch,
        fov = math.pi / 2.8,
        ceil = "#0d1117",
        floor = "#161b22",
        colors = colors,
        fog = 14,
        scale = 0.72
    })

    local w = gfx.width()
    gfx.text("Raycast 3D", 12, 28, "#fff", "16px sans-serif")
    gfx.text(string.format("yaw=%.1f  pitch=%.1f", player.angle, player.pitch), 12, 48, "#888", "12px monospace")
    gfx.text("Left stick move  ·  Right side drag to look", 12, 68, "#666", "12px sans-serif")

    local ms = 7
    local ox, oy = w - (#map[1] * ms) - 12, 12
    for my = 1, #map do
        for mx = 1, #map[1] do
            local cell = map[my][mx]
            local c = cell == 0 and "#222" or (colors[cell] or "#666")
            gfx.rectfill(ox + (mx-1)*ms, oy + (my-1)*ms, ms-1, ms-1, c)
        end
    end
    local px = ox + (player.x - 0.5) * ms
    local py = oy + (player.y - 0.5) * ms
    gfx.circlefill(px, py, 2.5, "#0f0")
    gfx.line(px, py, px + math.cos(player.angle)*6, py + math.sin(player.angle)*6, "#0f0")
end`
        }
    },
    runner: {
        name: "Infinite Runner",
        files: {
            "main.lua": `-- Infinite Runner — jump with A / Up / Space
local player = { x = 70, y = 200, vy = 0, onground = true, r = 14 }
local grav, jump = 1400, -420
local ground = 240
local obstacles = {}
local spawn, speed, score, dead = 0, 180, 0, false

function _update(dt)
    if dead then
        if btnp(4) or btnp(0) then
            obstacles, spawn, speed, score, dead = {}, 0, 180, 0, false
            player.y, player.vy, player.onground = ground, 0, true
        end
        return
    end
    player.vy = player.vy + grav * dt
    if (btnp(4) or btnp(0)) and player.onground then
        player.vy = jump
        player.onground = false
        sfx.beep(360, 0.06)
    end
    player.y = player.y + player.vy * dt
    if player.y >= ground then
        player.y, player.vy, player.onground = ground, 0, true
    end
    speed = speed + 8 * dt
    spawn = spawn - dt
    if spawn <= 0 then
        table.insert(obstacles, { x = 420, w = 18 + math.random(0, 14), h = 24 + math.random(0, 20) })
        spawn = 0.9 + math.random() * 0.7
    end
    for i = #obstacles, 1, -1 do
        local o = obstacles[i]
        o.x = o.x - speed * dt
        if o.x + o.w < -10 then
            table.remove(obstacles, i)
            score = score + 1
        elseif math.abs((player.x) - (o.x + o.w/2)) < player.r + o.w/2
            and player.y + player.r > ground - o.h then
            dead = true
            sfx.beep(120, 0.2, "sawtooth")
        end
    end
end

function _draw()
    gfx.cls("#0b1220")
    gfx.rectfill(0, ground + player.r, 400, 80, "#1b2838")
    gfx.circlefill(player.x, player.y, player.r, dead and "#888" or "#00e676")
    for _, o in ipairs(obstacles) do
        gfx.rectfill(o.x, ground + player.r - o.h, o.w, o.h, "#ff5252")
    end
    gfx.text("Score: " .. score, 12, 28, "#fff", "18px sans-serif")
    if dead then
        gfx.text("Game over — A / Up to retry", 12, 56, "#ffea00", "14px sans-serif")
    else
        gfx.text("A / Up / Space to jump", 12, 56, "#888", "13px sans-serif")
    end
end`
        }
    },
    breakout: {
        name: "Breakout",
        files: {
            "main.lua": `-- Breakout — move with stick / arrows, A to launch
local paddle = { x = 150, y = 300, w = 64, h = 10 }
local ball = { x = 180, y = 280, vx = 0, vy = 0, r = 6, live = false }
local bricks, rows, cols = {}, 5, 8
local score, lives = 0, 3

local function resetBall()
    ball.x, ball.y = paddle.x + paddle.w/2, paddle.y - 12
    ball.vx, ball.vy, ball.live = 0, 0, false
end

local function buildBricks()
    bricks = {}
    local colors = { "#ef5350", "#ff9800", "#ffeb3b", "#66bb6a", "#42a5f5" }
    for r = 1, rows do
        for c = 1, cols do
            table.insert(bricks, {
                x = 16 + (c-1) * 46, y = 40 + (r-1) * 18,
                w = 42, h = 14, hp = 1, color = colors[r]
            })
        end
    end
end

buildBricks()
resetBall()

function _update(dt)
    local ax = axis(0)
    if btn(2) then ax = -1 end
    if btn(3) then ax = 1 end
    paddle.x = math.max(8, math.min(320, paddle.x + ax * 280 * dt))
    if not ball.live then
        ball.x = paddle.x + paddle.w/2
        if btnp(4) or mouse.btn then
            ball.live = true
            ball.vx, ball.vy = 140, -180
            sfx.beep(600, 0.05)
        end
        return
    end
    ball.x = ball.x + ball.vx * dt
    ball.y = ball.y + ball.vy * dt
    if ball.x < 6 or ball.x > 354 then ball.vx = -ball.vx end
    if ball.y < 6 then ball.vy = -ball.vy end
    if ball.y > 340 then
        lives = lives - 1
        if lives <= 0 then
            score, lives = 0, 3
            buildBricks()
        end
        resetBall()
        return
    end
    if ball.y + ball.r >= paddle.y and ball.y < paddle.y + paddle.h
        and ball.x > paddle.x and ball.x < paddle.x + paddle.w and ball.vy > 0 then
        ball.vy = -math.abs(ball.vy)
        ball.vx = ((ball.x - (paddle.x + paddle.w/2)) / (paddle.w/2)) * 180
        sfx.beep(440, 0.04)
    end
    for i = #bricks, 1, -1 do
        local b = bricks[i]
        if ball.x > b.x and ball.x < b.x + b.w and ball.y > b.y and ball.y < b.y + b.h then
            table.remove(bricks, i)
            ball.vy = -ball.vy
            score = score + 10
            sfx.beep(720, 0.05)
            break
        end
    end
    if #bricks == 0 then buildBricks(); score = score + 100 end
end

function _draw()
    gfx.cls("#0a0e16")
    gfx.rectfill(paddle.x, paddle.y, paddle.w, paddle.h, "#e0e0e0")
    gfx.circlefill(ball.x, ball.y, ball.r, "#00e676")
    for _, b in ipairs(bricks) do gfx.rectfill(b.x, b.y, b.w, b.h, b.color) end
    gfx.text("Score " .. score .. "   Lives " .. lives, 12, 22, "#fff", "14px sans-serif")
    if not ball.live then gfx.text("A / click to launch", 12, 320, "#888", "13px sans-serif") end
end`
        }
    },
    race: {
        name: "Top-down Race",
        files: {
            "main.lua": `-- Top-down race — avoid traffic, stick/WASD to steer
local car = { x = 180, y = 260, w = 28, h = 40 }
local road_x, road_w = 80, 200
local traffic, spawn, speed, dist, dead = {}, 0, 160, 0, false

function _update(dt)
    if dead then
        if btnp(4) then
            traffic, spawn, speed, dist, dead = {}, 0, 160, 0, false
            car.x = 180
        end
        return
    end
    local ax = axis(0)
    if btn(2) then ax = -1 end
    if btn(3) then ax = 1 end
    car.x = math.max(road_x + 4, math.min(road_x + road_w - car.w - 4, car.x + ax * 220 * dt))
    speed = math.min(320, speed + 6 * dt)
    dist = dist + speed * dt
    spawn = spawn - dt
    if spawn <= 0 then
        table.insert(traffic, {
            x = road_x + 10 + math.random() * (road_w - 40),
            y = -50, w = 28, h = 40,
            color = ({ "#ff5252", "#ffea00", "#2979ff", "#e040fb" })[math.random(1,4)]
        })
        spawn = 0.55 + math.random() * 0.45
    end
    for i = #traffic, 1, -1 do
        local t = traffic[i]
        t.y = t.y + speed * dt
        if t.y > 400 then table.remove(traffic, i)
        elseif car.x < t.x + t.w and car.x + car.w > t.x
            and car.y < t.y + t.h and car.y + car.h > t.y then
            dead = true
            sfx.beep(100, 0.25, "sawtooth")
        end
    end
end

function _draw()
    gfx.cls("#1b5e20")
    gfx.rectfill(road_x, 0, road_w, 400, "#37474f")
    for i = 0, 8 do
        local yy = (i * 50 + (dist % 50))
        gfx.rectfill(road_x + road_w/2 - 3, yy, 6, 24, "#eee")
    end
    gfx.rectfill(car.x, car.y, car.w, car.h, "#00e676")
    for _, t in ipairs(traffic) do gfx.rectfill(t.x, t.y, t.w, t.h, t.color) end
    gfx.text(string.format("Distance %.0f m", dist / 10), 12, 28, "#fff", "16px sans-serif")
    if dead then gfx.text("Crash! A to retry", 12, 54, "#ffea00", "14px sans-serif")
    else gfx.text("Steer: stick / arrows", 12, 54, "#aaa", "13px sans-serif") end
end`
        }
    }
};

