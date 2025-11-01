import uvicorn
from app.config import get_host_port

if __name__ == "__main__":
    host, port = get_host_port()
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
