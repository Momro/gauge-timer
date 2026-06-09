# Home Assistant Gauge Timer Card
1. [install](#install)
2. [timer yaml](#timer-yaml)
3. [script](#script)
4. [images](#images)

# disclaimer
100% vibe coded with Opus/Copilot

# install

1. copy js file to `/config/www/`
2. Go to dashboards
3. click sandwich menu top right -> `Resources`
4. Bottom left, click `add resource`
5. URL: `/local/kitchen-timer-dial.js`
6. JavaScript Module
7. refresh browser/clear cache
8. enjoy

# timer yaml 

```
type: custom:kitchen-timer-dial
title: Küchentimer
input_entity: input_number.inp_kuchetimer
timer_entity: timer.tmr_kuchentimer
start_service: script.scr_kuchentimer
min: 0
max: 99
step: 1
idle_color: "#3b82f6"
track_color: rgba(180,180,180,0.35)
show_hint: false
finished_timeout: 0
knob_color: "#ffffff"
thresholds:
  - from: 75
    color: "#3b82f6"
  - from: 50
    color: "#22c55e"
  - from: 25
    color: "#eab308"
  - from: 10
    color: "#f97316"
  - from: 0
    color: "#ef4444"
```

# script
I don't remember why I needed that. Probably would work without that, too ...

```
sequence:
  - target:
      entity_id: timer.tmr_kuchentimer
    data:
      duration: "{{ '00:%02d:00' | format(states('input_number.inp_kuchetimer') | int) }}"
    action: timer.start
alias: SCR_Küchentimer
description: ""
```

# images

Waiting to be set:

<img width="468" height="383" alt="image" src="https://github.com/user-attachments/assets/bee6cbf8-e588-4268-910f-3648b04a2469" />

Beginning (blue):

<img width="469" height="377" alt="image" src="https://github.com/user-attachments/assets/1ceb14db-46d2-468b-902a-00231db3fd6f" />

Time is moving on (green):

<img width="455" height="374" alt="image" src="https://github.com/user-attachments/assets/cd40951d-393b-443f-a4f0-2a28347ce694" />

Time is running low (orange):

<img width="465" height="391" alt="image" src="https://github.com/user-attachments/assets/07b564de-b7da-470f-929b-d7a8cc1fcde7" />

Time is running out (red, flashing):

<img width="471" height="384" alt="image" src="https://github.com/user-attachments/assets/03d23a91-8117-4542-b37f-78f3402a1910" />

Finish (flashing red, with bell symbol):

<img width="470" height="384" alt="image" src="https://github.com/user-attachments/assets/cd45a4b7-7256-45c1-9f8c-27f9e24d26f5" />
