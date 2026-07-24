def test_health_check(client):
    """
    Test the health check endpoint.
    It should return a 200 OK status and the correct JSON payload.
    """
    response = client.get("/health")
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "1.0.0"
